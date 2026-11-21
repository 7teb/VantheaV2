import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { alive, create_run, expect, with_timeout } from "./headless-smoke-support.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const fake_openrouter = require("../tests/support/fake-openrouter.cjs");
const fake_openai = require("../tests/support/fake-openai.cjs");
const electron_exe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const app_links = ["dist", "dist-electron", "config", "skills", "Resources"];
const dummy_key = "sk-or-smoke-dummy-key";
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const system_temp = os.tmpdir();
const temp_prefix = "vx-tmp-chatgpt-";
const plan_model = "openai/gpt-6.2-sol";
const openrouter_models = ["deepseek/deepseek-v4.1-flash-1017", "openai/gpt-6.1-sol"];
const forbidden_keys = ["max_output_tokens", "temperature", "instructions", "metadata", "user", "service_tier"];

const temp = fs.mkdtempSync(path.join(system_temp, temp_prefix));
const dirs = { app: path.join(temp, "app"), data: path.join(temp, "data"), project: path.join(temp, "project"), tmp: path.join(temp, "tmp") };
const log_file = path.join(temp, "electron.log");
const servers = { openrouter: null, openai: null };
const state = {
  fake: { close: async () => Promise.all([servers.openrouter?.close(), servers.openai?.close()]) },
  vx: null,
  pid: null,
};
const { ready_lines, own_pids, link, cleanup } = create_run({ temp, system_temp, log_file });

const check = async (name, action) => {
  try {
    const detail = await action();
    console.log(`ok   ${name}${typeof detail === "string" && detail ? ` (${detail})` : ""}`);
  } catch (error) {
    const cause = error?.cause?.code ? ` (${error.cause.code})` : "";
    const instance = state.vx && state.pid ? `; instance pid ${state.pid} ${alive(state.pid) ? "still runs" : "has exited"}` : "";
    console.log(`FAIL ${name}: ${error?.message}${cause}${instance}`);
    throw Object.assign(new Error(`check failed: ${name}`), { reported: true, cause: error });
  }
};

const run_npm = (script) => {
  const result = spawnSync(`npm.cmd run ${script}`, { cwd: root, stdio: "inherit", shell: true });
  expect(result.status === 0, `npm run ${script} exited with ${result.status ?? result.signal}`);
};

const prepare_app = () => {
  fs.mkdirSync(dirs.app, { recursive: true });
  fs.writeFileSync(path.join(dirs.app, "package.json"), JSON.stringify({ name: "vantheax-chatgpt-plan-smoke", version, private: true, main: "headless-entry.cjs" }));
  fs.copyFileSync(path.join(root, "tests", "support", "headless-entry.cjs"), path.join(dirs.app, "headless-entry.cjs"));
  for (const name of app_links) {
    link(path.join(root, name), path.join(dirs.app, name));
  }
};

const profile_snapshot = () => ({ roaming: fs.readdirSync(process.env.APPDATA), local: fs.readdirSync(process.env.LOCALAPPDATA), headless: fs.existsSync(path.join(process.env.APPDATA, "VantheaX-headless")) });

const wait_until = async (probe, ms, label) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value.done) {
      return value;
    }
    expect(Date.now() < deadline, `${label} within ${ms / 1000} s, last seen ${value.seen}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

const fake_problems = () =>
  servers.openai.requests
    .filter((entry) => entry.problems.length)
    .map((entry) => `${entry.method} ${entry.route}: ${entry.problems.join("; ")}`)
    .join(" | ");

const openrouter_chats = () => servers.openrouter.requests.filter((entry) => entry.route === "/chat/completions").length;

const plan_requests = () => servers.openai.requests.filter((entry) => entry.route === "/v1/responses");

const main_turn = (events, run_id) => events.filter((event) => event.type === "turn.event" && event.data.message_id === run_id).map((event) => event.data);

const follow_sign_in = async (client) => {
  const stream = client.events({ signal: AbortSignal.timeout(60_000) });
  try {
    const hello = await stream.next();
    expect(!hello.done && hello.value.type === "hello", "the event stream did not open with a hello event");
    const started = await client.account.sign_in({});
    if (started.chatgpt.status !== "signing_in") {
      return started.chatgpt;
    }
    let attempt_seen = false;
    for (;;) {
      const next = await stream.next();
      expect(!next.done, "the event stream ended during the sign-in");
      const event = next.value;
      if (event.type !== "account.changed") {
        continue;
      }
      if (event.data.status === "signing_in") {
        attempt_seen = true;
        continue;
      }
      if (attempt_seen) {
        return event.data;
      }
    }
  } finally {
    await stream.return();
  }
};

const run_checks = async (sdk, before) => {
  await check("ready line arrives through create_vantheax", async () => {
    const launch = new AbortController();
    const timer = setTimeout(() => launch.abort(new Error("no ready line within 90 s")), 90_000);
    try {
      state.vx = await sdk.create_vantheax({ exe_path: electron_exe, args: [dirs.app], data_dir: dirs.data, openrouter_key: dummy_key, signal: launch.signal });
    } finally {
      clearTimeout(timer);
    }
    state.pid = ready_lines().find((entry) => entry.url === state.vx.url)?.pid ?? null;
    expect(state.pid !== null && alive(state.pid), `no live pid for ${state.vx.url} in the instance log`);
    return `${state.vx.url}, pid ${state.pid}`;
  });
  const client = state.vx.client;
  const api_view = { models: [], default_model: "" };
  await check("POST /v1/account/billing switches to the ChatGPT plan", async () => {
    api_view.models = (await client.models()).map((model) => model.id);
    api_view.default_model = (await client.info()).default_model;
    const info = await client.account.set_billing("chatgpt");
    expect(info.billing === "chatgpt" && info.chatgpt.status === "signed_out", `account ${JSON.stringify(info)}`);
    expect((await client.account.get()).billing === "chatgpt", "GET /v1/account does not report chatgpt");
  });
  await check("sign-in through the fake authorize redirect ends signed_in with plan usage", async () => {
    const account = await follow_sign_in(client);
    const problems = fake_problems();
    expect(account.status === "signed_in" && account.plan_enabled && account.email === fake_openai.account.email, `account ${JSON.stringify(account)}; fake problems: ${problems || "none"}`);
    expect(!problems, `fake problems: ${problems}`);
    const authorize = servers.openai.requests.find((entry) => entry.route === "/api/accounts/authorize");
    const exchange = servers.openai.requests.find((entry) => entry.route === "/api/accounts/oauth/token" && entry.form?.grant_type === "authorization_code");
    expect(authorize?.query.client_id === "dynamic_agent_client" && authorize.query.agent_name_hint === "VantheaX", `authorize ${JSON.stringify(authorize?.query.client_id)}`);
    expect(exchange?.form.client_id.startsWith("oaiapp_"), `exchange client ${exchange?.form?.client_id}`);
    return `${account.email}, client ${exchange.form.client_id}`;
  });
  await check("after the account list loads, GET /v1/models still lists the whole catalog and the default model stays", async () => {
    await wait_until(
      async () => {
        const listed = servers.openai.requests.filter((entry) => entry.method === "GET" && entry.route === "/v1/models").length;
        return { done: listed > 0, seen: `${listed} account model list requests` };
      },
      30_000,
      "the account model list request",
    );
    const ids = (await client.models()).map((model) => model.id);
    expect(JSON.stringify(ids) === JSON.stringify(api_view.models), `models ${ids.join(", ")}, API billing listed ${api_view.models.join(", ")}`);
    const info = await client.info();
    expect(info.default_model === api_view.default_model, `default_model ${info.default_model}, API billing had ${api_view.default_model}`);
    return `${ids.length} models, default ${info.default_model}`;
  });
  let session = null;
  const tool_events = [];
  let tool_run = null;
  await check("a tool turn over Responses SSE ends done", async () => {
    fs.mkdirSync(dirs.project, { recursive: true });
    fs.writeFileSync(path.join(dirs.project, "README.md"), "chatgpt plan smoke project\n");
    session = await client.sessions.create({ cwd: dirs.project, model: plan_model });
    tool_run = await client.run(session.id, { text: "SMOKE_PLAN_TOOL: call list_models once, then answer" }, { on_event: (event) => tool_events.push(event), signal: AbortSignal.timeout(120_000) });
    const turn = main_turn(tool_events, tool_run.run_id);
    const call = turn.find((data) => data.type === "tool_call" && data.name === "list_models");
    const end = call && turn.find((data) => data.type === "tool_end" && data.call_id === call.call_id);
    expect(tool_run.status === "done" && tool_run.text === fake_openai.answers.tool, `status ${tool_run.status}, text ${JSON.stringify(tool_run.text)}, error ${JSON.stringify(tool_run.error)}`);
    expect(end && end.status === "done", `list_models tool_end ${JSON.stringify(end ?? null)}`);
    expect(tool_run.usage.rounds === 2, `usage ${JSON.stringify(tool_run.usage)}`);
    return `run ${tool_run.run_id}, rounds ${tool_run.usage.rounds}`;
  });
  await check("the plan requests carry the fake bearer, store false, stream true, a leading developer message and no forbidden key", () => {
    const requests = plan_requests();
    expect(requests.length > 0, "the fake OpenAI got no /v1/responses request");
    for (const entry of requests) {
      const token = (entry.authorization ?? "").replace(/^Bearer /, "");
      const body = entry.body ?? {};
      const input = Array.isArray(body.input) ? body.input : [];
      expect(entry.authorization?.startsWith("Bearer ") && servers.openai.state.access_tokens.includes(token), `request ${entry.index} bearer ${entry.authorization ? "unknown" : "missing"}`);
      expect(body.store === false && body.stream === true, `request ${entry.index} store ${body.store}, stream ${body.stream}`);
      expect(input[0]?.type === "message" && input[0].role === "developer", `request ${entry.index} first input ${JSON.stringify(input[0])?.slice(0, 200)}`);
      const present = forbidden_keys.filter((key) => Object.hasOwn(body, key));
      expect(present.length === 0, `request ${entry.index} sends ${present.join(", ")}`);
      if (entry.kind === "round") {
        expect(input[1]?.type === "additional_tools" && input[1].role === "developer", `round request ${entry.index} second input ${input[1]?.type}`);
      }
    }
    const rounds = requests.filter((entry) => entry.kind === "round").length;
    expect(rounds >= 2, `${rounds} round requests`);
    return `${requests.length} requests, ${rounds} rounds`;
  });
  await check("the second round replays the reasoning item, the function_call and its output with call_id call_smoke_1", () => {
    const second = plan_requests().find((entry) => entry.kind === "round" && entry.scenario === "SMOKE_PLAN_TOOL" && entry.round === 1);
    expect(second, "no second round request of the tool turn");
    const input = second.body.input;
    const at = input.findIndex((item) => item.type === "function_call" && item.call_id === fake_openai.tool_call_id);
    expect(at > 0, `no function_call with call_id ${fake_openai.tool_call_id}`);
    expect(input[at].name === "list_models" && typeof input[at].arguments === "string", `function_call ${JSON.stringify(input[at])}`);
    expect(input[at + 1]?.type === "function_call_output" && input[at + 1].call_id === fake_openai.tool_call_id, `item after the call ${JSON.stringify(input[at + 1])?.slice(0, 200)}`);
    expect(input.slice(0, at).some((item) => item.type === "reasoning" && item.encrypted_content === "enc_smoke_1"), "the reasoning item with its encrypted_content is not replayed before the call");
    return `call at input ${at}`;
  });
  await check("the fake OpenRouter received no chat completion request", () => {
    expect(openrouter_chats() === 0, `${openrouter_chats()} /chat/completions requests`);
    return `${servers.openrouter.requests.length} other OpenRouter requests`;
  });
  await check("a usage limit ends the run failed with plan_limit and still no OpenRouter chat request", async () => {
    const run = await client.run(session.id, { text: "SMOKE_LIMIT: this turn hits the usage limit" }, { signal: AbortSignal.timeout(120_000) });
    expect(run.status === "failed" && run.error?.kind === "plan_limit", `status ${run.status}, error ${JSON.stringify(run.error)}`);
    expect(plan_requests().some((entry) => entry.kind === "round" && entry.scenario === "SMOKE_LIMIT"), "the limit turn sent no round request to the fake");
    expect(openrouter_chats() === 0, `${openrouter_chats()} /chat/completions requests`);
    return run.error.message;
  });
  await check("DeepSeek and an OpenAI model the account does not list each run through the OpenRouter key", async () => {
    for (const model of openrouter_models) {
      const chats = openrouter_chats();
      const run = await client.run(session.id, { text: "SMOKE_TEXT: answer through OpenRouter", model }, { signal: AbortSignal.timeout(120_000) });
      expect(run.status === "done" && run.text === fake_openrouter.answers.text, `${model}: status ${run.status}, text ${JSON.stringify(run.text)}, error ${JSON.stringify(run.error)}`);
      expect(openrouter_chats() === chats + 1, `${model}: ${openrouter_chats() - chats} /chat/completions requests`);
    }
    return openrouter_models.join(", ");
  });
  await check("sign-out reaches the revoke endpoint with the refresh token and the account reports signed_out", async () => {
    const exchange = servers.openai.requests.find((entry) => entry.route === "/api/accounts/oauth/token" && entry.form?.grant_type === "authorization_code");
    const client_id = exchange.form.client_id;
    const refresh_token = servers.openai.state.refresh_tokens.get(client_id);
    const info = await client.account.sign_out();
    expect(info.chatgpt.status === "signed_out" && info.chatgpt.error === null, `account ${JSON.stringify(info.chatgpt)}`);
    expect(servers.openai.state.revoked.some((entry) => entry.client_id === client_id && entry.token === refresh_token), `revoked ${servers.openai.state.revoked.length} tokens, none is the current refresh token`);
    expect((await client.account.get()).chatgpt.status === "signed_out", "GET /v1/account does not report signed_out");
  });
  await check("the instance exits by itself after close() (stdin lease)", async () => {
    await with_timeout(state.vx.close(), 60_000, "close()");
    state.vx = null;
    expect(!alive(state.pid), `pid ${state.pid} still runs`);
    return `pid ${state.pid} ended`;
  });
  await check("no spawned process is left", async () => {
    const deadline = Date.now() + 15_000;
    while (own_pids().length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(own_pids().length === 0, `still running: ${own_pids().join(", ")}`);
  });
  await check("nothing was written to the user profile", () => {
    const after = profile_snapshot();
    const added = [...after.roaming.filter((name) => !before.roaming.includes(name)), ...after.local.filter((name) => !before.local.includes(name))];
    expect(!before.headless && !after.headless, `%APPDATA%\\VantheaX-headless existed before: ${before.headless}, after: ${after.headless}`);
    expect(added.length === 0, `new entries in %APPDATA% or %LOCALAPPDATA%: ${added.join(", ")}`);
  });
};

const main = async () => {
  try {
    await check("build: npm run build and npm run build:sdk", () => {
      run_npm("build");
      run_npm("build:sdk");
      const missing = [path.join(root, "dist-electron", "main.js"), path.join(root, "dist-sdk", "index.js"), electron_exe].filter((file) => !fs.existsSync(file));
      expect(missing.length === 0, `missing after the build: ${missing.join(", ")}`);
    });
    const sdk = await import(pathToFileURL(path.join(root, "dist-sdk", "index.js")).href);
    const before = profile_snapshot();
    servers.openrouter = await fake_openrouter.start_fake_openrouter();
    servers.openai = await fake_openai.start_fake_openai();
    fs.mkdirSync(dirs.tmp, { recursive: true });
    Object.assign(process.env, { VX_SMOKE_OPENROUTER_URL: servers.openrouter.url, VX_SMOKE_OPENAI_URL: servers.openai.url, VX_SMOKE_LOG: log_file, TEMP: dirs.tmp, TMP: dirs.tmp });
    prepare_app();
    await run_checks(sdk, before);
    console.log("[smoke] all checks passed");
  } catch (error) {
    if (!error.reported) {
      console.log(`FAIL setup: ${error.stack || error.message}`);
    }
    if (fs.existsSync(log_file)) {
      console.log(`[smoke] last lines of the instance log:\n${fs.readFileSync(log_file, "utf8").split(/\r?\n/).slice(-60).join("\n")}`);
    }
    process.exitCode = 1;
  } finally {
    await cleanup(state);
    if (fs.existsSync(temp)) {
      console.log(`FAIL the temp folder ${temp} is still there`);
      process.exitCode = 1;
    } else {
      console.log(`ok   the temp folder ${temp} is removed`);
    }
  }
};

await main();
