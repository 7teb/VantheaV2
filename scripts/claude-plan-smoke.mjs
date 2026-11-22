import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { alive, create_run, expect, with_timeout } from "./headless-smoke-support.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fake_openrouter = createRequire(import.meta.url)("../tests/support/fake-openrouter.cjs");
const fake_claude = path.join(root, "tests", "support", "fake-claude.mjs");
const electron_exe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const app_links = ["dist", "dist-electron", "config", "skills", "Resources"];
const dummy_key = "sk-or-smoke-dummy-key";
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const system_temp = os.tmpdir();
const temp_prefix = "vx-tmp-claude-";
const claude_model = "anthropic/claude-sonnet-5.5";
const claude_code_model = "claude-sonnet-5-5";
const openrouter_model = "deepseek/deepseek-v4.1-flash-1017";
const notes_text = "claude plan smoke notes: the bridge read this file";
const answers = { intro: "Reading the notes.", final: "The notes say the bridge works.", second: "Second turn on the same Claude Code session." };
const prompt_markers = ["You are VantheaX, a hands-on coding agent.", "The application adds system reminders to this conversation."];
const scrubbed = { ANTHROPIC_API_KEY: "sk-ant-smoke-dummy", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "inherited" };
const hop_headers = ["connection", "keep-alive", "transfer-encoding", "content-length", "host"];

const temp = fs.mkdtempSync(path.join(system_temp, temp_prefix));
const dirs = { app: path.join(temp, "app"), data: path.join(temp, "data"), project: path.join(temp, "project"), tmp: path.join(temp, "tmp"), claude: path.join(temp, "claude-config") };
const files = { log: path.join(temp, "electron.log"), scenario: path.join(temp, "claude-scenario.json"), claude_log: path.join(temp, "fake-claude.ndjson") };
const servers = { openrouter: null, proxy: null };
const state = {
  fake: { close: async () => Promise.all([servers.proxy?.close(), servers.openrouter?.close()]) },
  vx: null,
  pid: null,
};
const { ready_lines, own_pids, link, cleanup } = create_run({ temp, system_temp, log_file: files.log });

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
  fs.writeFileSync(path.join(dirs.app, "package.json"), JSON.stringify({ name: "vantheax-claude-plan-smoke", version, private: true, main: "headless-entry.cjs" }));
  fs.copyFileSync(path.join(root, "tests", "support", "headless-entry.cjs"), path.join(dirs.app, "headless-entry.cjs"));
  for (const name of app_links) {
    link(path.join(root, name), path.join(dirs.app, name));
  }
};

const stamps = (dir, depth) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name);
    const own = `${entry.name} ${fs.statSync(at).mtimeMs}`;
    return [own, ...(entry.isDirectory() && depth > 1 ? stamps(at, depth - 1).map((name) => `${entry.name}/${name}`) : [])];
  });

const headless_profile = path.join(process.env.APPDATA, "VantheaX-headless");

const profile_snapshot = () => ({
  roaming: fs.readdirSync(process.env.APPDATA),
  local: fs.readdirSync(process.env.LOCALAPPDATA),
  headless: fs.existsSync(headless_profile) ? JSON.stringify(stamps(headless_profile, 3)) : null,
});

const strip_hops = (headers) => Object.fromEntries(Object.entries(headers).filter(([name]) => !hop_headers.includes(name.toLowerCase())));

const start_recording_proxy = (target) =>
  new Promise((resolve, reject) => {
    const chats = [];
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("error", (error) => console.error(`[smoke] reading ${request.method} ${request.url} failed: ${error.message}`));
      request.on("end", () => {
        const body = Buffer.concat(chunks);
        const route = new URL(request.url, "http://127.0.0.1").pathname.replace(/^\/api\/v1/, "");
        if (route === "/chat/completions") {
          try {
            const parsed = JSON.parse(body.toString("utf8") || "{}");
            chats.push({ model: String(parsed.model ?? ""), stream: parsed.stream === true });
          } catch (error) {
            chats.push({ model: `unparsable body: ${error.message}`, stream: false });
          }
        }
        const forward = http.request(new URL(request.url, target), { method: request.method, headers: { ...strip_hops(request.headers), "content-length": body.length } }, (answer) => {
          response.writeHead(answer.statusCode ?? 502, strip_hops(answer.headers));
          answer.pipe(response);
        });
        forward.on("error", (error) => {
          console.error(`[smoke] forwarding ${request.method} ${route} to the fake OpenRouter failed: ${error.message}`);
          if (!response.headersSent) {
            response.writeHead(502);
          }
          response.end();
        });
        forward.end(body);
      });
    });
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const { port } = server.address();
      const close = () =>
        new Promise((done) => {
          server.close(() => done());
          server.closeAllConnections();
        });
      resolve({ url: `http://127.0.0.1:${port}`, chats, close });
    });
  });

const write_scenario = (auth, turns) => fs.writeFileSync(files.scenario, JSON.stringify({ auth, turns }));

const claude_log = () =>
  fs.existsSync(files.claude_log)
    ? fs
        .readFileSync(files.claude_log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

const spawn_records = () =>
  (fs.existsSync(files.log) ? fs.readFileSync(files.log, "utf8").split(/\r?\n/) : []).filter((line) => line.startsWith('{"vx_smoke":"claude_spawn"')).map((line) => JSON.parse(line));

const flag = (argv, name) => {
  for (const [at, arg] of argv.entries()) {
    if (arg === name) {
      return argv[at + 1] ?? "";
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return null;
};

const session_runs = (entries) => entries.filter((entry) => entry.kind === "argv" && entry.argv[0] !== "auth" && !entry.argv.includes("--version"));

const received = (entries) => entries.flatMap((entry) => (entry.kind === "in" && entry.frame ? [entry.frame] : []));

const control_requests = (entries, subtype) => received(entries).flatMap((frame) => (frame.type === "control_request" && frame.request?.subtype === subtype ? [frame.request] : []));

const mcp_results = (entries) => received(entries).flatMap((frame) => (frame.type === "control_response" && frame.response?.response?.mcp_response ? [frame.response.response.mcp_response] : []));

const anthropic_chats = () => servers.proxy.chats.filter((entry) => entry.model.startsWith("anthropic/"));

const main_turn = (events, run_id) => events.filter((event) => event.type === "turn.event" && event.data.message_id === run_id).map((event) => event.data);

const fake_pids = () => claude_log().flatMap((entry) => (entry.kind === "argv" && entry.pid ? [entry.pid] : []));

const live_pids = () => [...new Set([...own_pids(), ...fake_pids().filter((pid) => alive(pid))])];

const run_prompt = async (client, session_id, text, events = []) =>
  client.run(session_id, { text }, { on_event: (event) => events.push(event), signal: AbortSignal.timeout(120_000) });

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
  await check("1 POST /v1/account/claude-billing switches to the Claude plan and the refresh reports signed_in", async () => {
    const info = await client.account.set_claude_billing("claude");
    expect(info.claude_billing === "claude" && info.billing === "api", `account ${JSON.stringify(info)}`);
    const got = await client.account.get();
    expect(got.claude_billing === "claude", `GET /v1/account reports claude_billing ${got.claude_billing}`);
    const refreshed = await client.account.refresh_claude();
    expect(refreshed.claude.status === "signed_in" && refreshed.claude.email === "fake@example.invalid", `claude ${JSON.stringify(refreshed.claude)}`);
    expect(refreshed.claude.login_command.includes("auth login --claudeai"), `login_command ${JSON.stringify(refreshed.claude.login_command)}`);
    return `${refreshed.claude.email}, ${refreshed.claude.subscription}`;
  });
  let session = null;
  let first_session_id = "";
  const turn_mark = { claude: 0, spawns: 0 };
  await check("2 a Claude-plan turn with a read_file call settles done with tool rows, one end and usage, without an anthropic/ OpenRouter request", async () => {
    fs.mkdirSync(dirs.project, { recursive: true });
    fs.writeFileSync(path.join(dirs.project, "notes.txt"), `${notes_text}\n`);
    write_scenario("signed_in", [[{ text: answers.intro }, { tool: "read_file", input: { path: "notes.txt" } }, { text: answers.final }, { result: true }]]);
    turn_mark.claude = claude_log().length;
    turn_mark.spawns = spawn_records().length;
    session = await client.sessions.create({ cwd: dirs.project, model: claude_model });
    const events = [];
    const run = await run_prompt(client, session.id, "Read notes.txt and tell me what it says.", events);
    expect(run.status === "done" && run.text.includes(answers.final), `status ${run.status}, text ${JSON.stringify(run.text)}, error ${JSON.stringify(run.error)}`);
    const turn = main_turn(events, run.run_id);
    const call = turn.find((data) => data.type === "tool_call" && data.name === "read_file");
    expect(call, `no read_file tool_call, turn events ${[...new Set(turn.map((data) => data.type))].join(", ")}`);
    expect(turn.some((data) => data.type === "tool_start" && data.call_id === call.call_id), "no tool_start for read_file");
    const end = turn.find((data) => data.type === "tool_end" && data.call_id === call.call_id);
    expect(end?.status === "done", `read_file tool_end ${JSON.stringify(end ?? null)}`);
    expect(turn.some((data) => data.type === "text"), "no text event");
    const ends = turn.filter((data) => data.type === "end");
    expect(ends.length === 1 && ends[0].status === "done", `end events ${JSON.stringify(ends)}`);
    expect(run.usage.prompt_tokens > 0 && run.usage.completion_tokens > 0, `usage ${JSON.stringify(run.usage)}`);
    expect(anthropic_chats().length === 0, `anthropic/ chat requests at the fake OpenRouter: ${anthropic_chats().map((entry) => entry.model).join(", ")}`);
    return `run ${run.run_id}, usage ${JSON.stringify(run.usage)}`;
  });
  await check("3 the fake Claude Code got the model, the VantheaX tools and system prompt, the tool result and a scrubbed environment", () => {
    const entries = claude_log().slice(turn_mark.claude);
    const runs = session_runs(entries);
    expect(runs.length === 1, `${runs.length} Claude Code session processes for one turn`);
    const argv = runs[0].argv;
    expect(flag(argv, "--model") === claude_code_model, `--model ${flag(argv, "--model")}, argv ${argv.join(" ")}`);
    first_session_id = flag(argv, "--session-id") ?? "";
    expect(first_session_id && flag(argv, "--resume") === null, `--session-id ${first_session_id}, --resume ${flag(argv, "--resume")}`);
    const listed = mcp_results(entries).flatMap((answer) => (answer.result?.tools ?? []).map((tool) => tool.name));
    const expected_tools = ["read_file", "list_files", "write_file"];
    expect(expected_tools.every((name) => listed.includes(name)), `tools/list gave ${listed.join(", ") || "nothing"}`);
    const [initialize] = control_requests(entries, "initialize");
    const prompt = [initialize?.systemPrompt ?? ""].flat().join("\n");
    const missing = prompt_markers.filter((marker) => !prompt.includes(marker));
    expect(missing.length === 0, `the initialize request misses ${missing.join(" | ")} (system prompt ${prompt.length} chars)`);
    const result_text = JSON.stringify(mcp_results(entries).filter((answer) => Array.isArray(answer.result?.content)));
    expect(result_text.includes(notes_text), `no tools/call result carries the notes text: ${result_text.slice(0, 300)}`);
    const names = entries.filter((entry) => entry.kind === "env").flatMap((entry) => entry.names.map((name) => name.toUpperCase()));
    const leaked = ["ANTHROPIC_API_KEY", "CLAUDECODE"].filter((name) => names.includes(name));
    expect(names.length > 0 && leaked.length === 0, `leaked into the child: ${leaked.join(", ")}`);
    const records = spawn_records().slice(turn_mark.spawns);
    expect(records.length > 0 && records.every((record) => record.entrypoint !== scrubbed.CLAUDE_CODE_ENTRYPOINT), `spawn records ${JSON.stringify(records.map((record) => record.entrypoint))}`);
    return `session ${first_session_id}, ${listed.length} tools, prompt ${prompt.length} chars, entrypoints ${[...new Set(records.map((record) => String(record.entrypoint)))].join("/")}`;
  });
  await check("4 a second prompt in the same session resumes the first Claude Code session", async () => {
    write_scenario("signed_in", [[{ text: answers.second }, { result: true }]]);
    const mark = claude_log().length;
    const run = await run_prompt(client, session.id, "And one more turn.");
    expect(run.status === "done" && run.text.includes(answers.second), `status ${run.status}, text ${JSON.stringify(run.text)}, error ${JSON.stringify(run.error)}`);
    const runs = session_runs(claude_log().slice(mark));
    expect(runs.length === 1, `${runs.length} Claude Code session processes`);
    const resumed = flag(runs[0].argv, "--resume");
    expect(resumed === first_session_id, `--resume ${resumed}, first session ${first_session_id}, argv ${runs[0].argv.join(" ")}`);
    return `--resume ${resumed}`;
  });
  await check("5 a prompt on an OpenRouter model in a new session reaches the fake OpenRouter and starts no Claude Code", async () => {
    const mark = claude_log().length;
    const chats = servers.proxy.chats.length;
    const other = await client.sessions.create({ cwd: dirs.project, model: openrouter_model });
    const run = await run_prompt(client, other.id, "SMOKE_TEXT: answer through OpenRouter");
    expect(run.status === "done" && run.text === fake_openrouter.answers.text, `status ${run.status}, text ${JSON.stringify(run.text)}, error ${JSON.stringify(run.error)}`);
    const rounds = servers.proxy.chats.slice(chats).filter((entry) => entry.model === openrouter_model && entry.stream);
    expect(rounds.length === 1, `${rounds.length} streamed ${openrouter_model} requests, models seen ${servers.proxy.chats.slice(chats).map((entry) => entry.model).join(", ")}`);
    expect(session_runs(claude_log().slice(mark)).length === 0, "the OpenRouter turn started a Claude Code session");
    return `${rounds.length} round on ${openrouter_model}`;
  });
  await check("6 a usage limit ends the run failed with claude_limit and no anthropic/ OpenRouter request", async () => {
    write_scenario("signed_in", [[{ text: "Starting." }, { usage_limit: true }]]);
    const limited = await client.sessions.create({ cwd: dirs.project, model: claude_model });
    const run = await run_prompt(client, limited.id, "This turn hits the usage limit.");
    expect(run.status === "failed" && run.error?.kind === "claude_limit", `status ${run.status}, error ${JSON.stringify(run.error)}`);
    expect(anthropic_chats().length === 0, `anthropic/ chat requests at the fake OpenRouter: ${anthropic_chats().map((entry) => entry.model).join(", ")}`);
    return run.error.message;
  });
  await check("7 a Claude Code auth error ends with claude_auth and the refresh reports signed_out", async () => {
    write_scenario("signed_out", [[{ auth_error: true }]]);
    const signed_out = await client.sessions.create({ cwd: dirs.project, model: claude_model });
    const run = await run_prompt(client, signed_out.id, "This turn has no Claude login.");
    expect(run.status === "failed" && run.error?.kind === "claude_auth", `status ${run.status}, error ${JSON.stringify(run.error)}`);
    const refreshed = await client.account.refresh_claude();
    expect(refreshed.claude.status === "signed_out", `claude ${JSON.stringify(refreshed.claude)}`);
    expect(anthropic_chats().length === 0, `anthropic/ chat requests at the fake OpenRouter: ${anthropic_chats().map((entry) => entry.model).join(", ")}`);
    return `${run.error.message}; refresh ${refreshed.claude.status}`;
  });
  await check("8 POST /v1/account/billing still switches the GPT billing and leaves the Claude switch alone", async () => {
    const plan = await client.account.set_billing("chatgpt");
    expect(plan.billing === "chatgpt" && plan.claude_billing === "claude", `account ${JSON.stringify({ billing: plan.billing, claude_billing: plan.claude_billing })}`);
    expect((await client.account.get()).billing === "chatgpt", "GET /v1/account does not report chatgpt");
    const api = await client.account.set_billing("api");
    expect(api.billing === "api" && api.claude_billing === "claude", `account ${JSON.stringify({ billing: api.billing, claude_billing: api.claude_billing })}`);
    return `chatgpt, then api; claude_billing ${api.claude_billing}`;
  });
  await check("9 shutdown: the instance exits, no process of this run is left and the user profile is untouched", async () => {
    await with_timeout(state.vx.close(), 60_000, "close()");
    state.vx = null;
    expect(!alive(state.pid), `pid ${state.pid} still runs`);
    const deadline = Date.now() + 15_000;
    while (live_pids().length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(live_pids().length === 0, `still running: ${live_pids().join(", ")}`);
    const after = profile_snapshot();
    const added = [...after.roaming.filter((name) => !before.roaming.includes(name)), ...after.local.filter((name) => !before.local.includes(name))];
    expect(after.headless === before.headless, `%APPDATA%\\VantheaX-headless changed during the run (existed before: ${before.headless !== null}, after: ${after.headless !== null})`);
    expect(added.length === 0, `new entries in %APPDATA% or %LOCALAPPDATA%: ${added.join(", ")}`);
    const records = spawn_records();
    expect(records.length === fake_pids().length, `${records.length} rerouted claude.exe spawns, ${fake_pids().length} fake Claude Code processes`);
    return `${fake_pids().length} fake Claude Code processes, all rerouted and ended`;
  });
};

const main = async () => {
  try {
    await check("build: npm run build and npm run build:sdk", () => {
      run_npm("build");
      run_npm("build:sdk");
      const missing = [path.join(root, "dist-electron", "main.js"), path.join(root, "dist-sdk", "index.js"), electron_exe, fake_claude].filter((file) => !fs.existsSync(file));
      expect(missing.length === 0, `missing after the build: ${missing.join(", ")}`);
    });
    const sdk = await import(pathToFileURL(path.join(root, "dist-sdk", "index.js")).href);
    const before = profile_snapshot();
    servers.openrouter = await fake_openrouter.start_fake_openrouter();
    servers.proxy = await start_recording_proxy(servers.openrouter.url);
    for (const dir of [dirs.tmp, dirs.claude]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    write_scenario("signed_in", []);
    Object.assign(process.env, {
      VX_SMOKE_OPENROUTER_URL: servers.proxy.url,
      VX_SMOKE_LOG: files.log,
      VX_SMOKE_CLAUDE: fake_claude,
      VX_SMOKE_NODE: process.execPath,
      VX_FAKE_CLAUDE_SCENARIO: files.scenario,
      VX_FAKE_CLAUDE_LOG: files.claude_log,
      CLAUDE_CONFIG_DIR: dirs.claude,
      TEMP: dirs.tmp,
      TMP: dirs.tmp,
      ...scrubbed,
    });
    prepare_app();
    await run_checks(sdk, before);
    expect(fs.existsSync(files.claude_log) && spawn_records().length > 0, "the fake Claude Code log or the reroute records are missing");
    console.log("[smoke] all checks passed");
  } catch (error) {
    if (!error.reported) {
      console.log(`FAIL setup: ${error.stack || error.message}`);
    }
    if (fs.existsSync(files.log)) {
      console.log(`[smoke] last lines of the instance log:\n${fs.readFileSync(files.log, "utf8").split(/\r?\n/).slice(-60).join("\n")}`);
    }
    process.exitCode = 1;
  } finally {
    if (state.vx) {
      await with_timeout(state.vx.close(), 30_000, "close() during cleanup").catch((error) => console.error(`[smoke] ${error.message}`));
      state.vx = null;
    }
    for (const pid of fake_pids().filter((entry) => alive(entry))) {
      console.error(`[smoke] stopping the leftover fake Claude Code process ${pid}`);
      process.kill(pid);
    }
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
