import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { alive, create_run, expect, windows_of, with_timeout } from "./headless-smoke-support.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fake = createRequire(import.meta.url)("../tests/support/fake-openrouter.cjs");
const electron_dir = path.join(root, "node_modules", "electron", "dist");
const electron_exe = path.join(electron_dir, "electron.exe");
const cli_js = path.join(root, "dist-sdk", "cli.js");
const app_links = ["dist", "dist-electron", "config", "skills", "Resources"];
const dummy_key = "sk-or-smoke-dummy-key";
const reject_text = "This run has no one to approve actions";
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const system_temp = os.tmpdir();

const temp = fs.mkdtempSync(path.join(system_temp, "vx-tmp-headless-"));
const dirs = { app: path.join(temp, "app"), data: path.join(temp, "data"), project: path.join(temp, "project"), exe: path.join(temp, "exe"), tmp: path.join(temp, "tmp") };
const log_file = path.join(temp, "electron.log");
const state = { fake: null, vx: null, pid: null };
const { ready_lines, own_pids, start, link, cleanup } = create_run({ temp, system_temp, log_file });

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

const raw_get = (base, route, headers) =>
  new Promise((resolve, reject) => {
    const request = http.get(new URL(route, base), { headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (text) => (body += text));
      response.on("end", () => resolve({ status: response.statusCode, code: JSON.parse(body || "{}").error?.code ?? null }));
    });
    request.on("error", reject);
  });

const read_events = async (client, options, done, ms) => {
  const seen = [];
  for await (const event of client.events({ ...options, signal: AbortSignal.timeout(ms) })) {
    seen.push(event);
    if (done(event)) {
      break;
    }
  }
  return seen;
};

const prepare_app = () => {
  fs.mkdirSync(dirs.app, { recursive: true });
  fs.writeFileSync(path.join(dirs.app, "package.json"), JSON.stringify({ name: "vantheax-headless-smoke", version, private: true, main: "headless-entry.cjs" }));
  fs.copyFileSync(path.join(root, "tests", "support", "headless-entry.cjs"), path.join(dirs.app, "headless-entry.cjs"));
  for (const name of app_links) {
    link(path.join(root, name), path.join(dirs.app, name));
  }
};

const prepare_exe = () => {
  const resources = path.join(electron_dir, "resources");
  fs.cpSync(electron_dir, dirs.exe, { recursive: true, filter: (source) => source !== resources && !source.endsWith("LICENSES.chromium.html") });
  fs.mkdirSync(path.join(dirs.exe, "resources"));
  link(dirs.app, path.join(dirs.exe, "resources", "app"));
};

const git = (...args) => execFileSync("git", ["-c", "user.name=Smoke", "-c", "user.email=smoke@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd: dirs.project, stdio: "pipe" });

const prepare_project = () => {
  fs.mkdirSync(dirs.project, { recursive: true });
  fs.writeFileSync(path.join(dirs.project, "README.md"), "smoke project\n");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Initial");
};

const profile_snapshot = () => ({ roaming: fs.readdirSync(process.env.APPDATA), local: fs.readdirSync(process.env.LOCALAPPDATA), headless: fs.existsSync(path.join(process.env.APPDATA, "VantheaX-headless")) });

const listing = (dir, depth) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => [entry.name, ...(entry.isDirectory() && depth > 1 ? listing(path.join(dir, entry.name), depth - 1).map((name) => `${entry.name}/${name}`) : [])])
    : [];

const run_cli = (args) =>
  start(process.execPath, [cli_js, "run", ...args, "--cwd", dirs.project, "--exe", path.join(dirs.exe, "electron.exe"), "--data-dir", dirs.data], { OPENROUTER_API_KEY: dummy_key }).wait(
    180_000,
    `vantheax run ${args[0]}`,
  );

const json_lines = (text) => text.trim().split(/\r?\n/).map((line) => JSON.parse(line));

const main_turn = (events, run_id) => events.filter((event) => event.type === "turn.event" && event.data.message_id === run_id).map((event) => event.data);

const run_checks = async (sdk, before) => {
  await check("ready line arrives through create_vantheax", async () => {
    const launch = new AbortController();
    const timer = setTimeout(() => launch.abort(new Error("no ready line within 90 s")), 90_000);
    try {
      state.vx = await sdk.create_vantheax({ exe_path: electron_exe, args: [dirs.app], data_dir: dirs.data, openrouter_key: dummy_key, signal: launch.signal });
    } finally {
      clearTimeout(timer);
    }
    expect(/^http:\/\/127\.0\.0\.1:\d+$/.test(state.vx.url), `unexpected url ${state.vx.url}`);
    state.pid = ready_lines().find((entry) => entry.url === state.vx.url)?.pid ?? null;
    expect(state.pid !== null && alive(state.pid), `no live pid for ${state.vx.url} in the instance log`);
    return `${state.vx.url}, pid ${state.pid}`;
  });
  const client = state.vx.client;
  await check("info and models answer", async () => {
    const info = await client.info();
    expect(info.name === "VantheaX" && info.api === 1 && info.headless === true && info.version === version, `info ${JSON.stringify(info)}`);
    expect(info.default_mode === "auto" && info.default_approvals === "reject", `defaults ${info.default_mode}/${info.default_approvals}`);
    const models = await client.models();
    expect(models.length > 0 && models.every((model) => typeof model.id === "string" && Array.isArray(model.efforts)), `models ${JSON.stringify(models).slice(0, 300)}`);
    return `version ${info.version}, ${models.length} models, default ${info.default_model}`;
  });
  let session = null;
  await check("session is created on a temp project folder", async () => {
    prepare_project();
    session = await client.sessions.create({ cwd: dirs.project });
    expect(session.project_path === dirs.project, `project_path ${session.project_path}`);
    expect((await client.sessions.list()).some((entry) => entry.id === session.id), "the new session is not listed");
    return session.id;
  });
  const text_events = [];
  let text_run = null;
  await check("run() returns done with the scripted text", async () => {
    text_run = await client.run(session.id, { text: "SMOKE_TEXT: answer with the scripted text" }, { on_event: (event) => text_events.push(event), signal: AbortSignal.timeout(120_000) });
    expect(text_run.status === "done", `status ${text_run.status}, error ${JSON.stringify(text_run.error)}`);
    expect(text_run.text === fake.answers.text, `text ${JSON.stringify(text_run.text)}`);
    return `run ${text_run.run_id}`;
  });
  await check("the stream had exactly one end event and one run.settled", () => {
    const ends = main_turn(text_events, text_run.run_id).filter((data) => data.type === "end");
    const settled = text_events.filter((event) => event.type === "run.settled" && event.data.run_id === text_run.run_id);
    expect(ends.length === 1, `${ends.length} end events`);
    expect(settled.length === 1 && settled[0].data.status === "done", `run.settled ${JSON.stringify(settled.map((event) => event.data))}`);
    return `${text_events.length} events`;
  });
  await check("usage has non-zero tokens", () => {
    const usage = text_run.usage;
    expect(usage.prompt_tokens > 0 && usage.completion_tokens > 0 && usage.reasoning_tokens > 0 && usage.rounds === 1, `usage ${JSON.stringify(usage)}`);
    return JSON.stringify(usage);
  });
  await check("built-in skills resolve from the app path", () => {
    const first = state.fake.requests.find((entry) => entry.kind === "round");
    expect(first && JSON.stringify(first.messages.find((message) => message.role === "system")?.content ?? "").includes("- vantheax: "), "the system prompt lists no vantheax skill");
  });
  const tool_events = [];
  let tool_run = null;
  await check("approvals reject: the tool call ends denied and the run ends done", async () => {
    tool_run = await client.run(session.id, { text: "SMOKE_TOOL: run the scripted command" }, { on_event: (event) => tool_events.push(event), signal: AbortSignal.timeout(120_000) });
    const turn = main_turn(tool_events, tool_run.run_id);
    const call = turn.find((data) => data.type === "tool_call" && data.name === "run_command");
    expect(call, "no run_command tool_call event");
    expect(turn.some((data) => data.type === "tool_approval" && data.call_id === call.call_id), "no tool_approval event");
    const decision = turn.find((data) => data.type === "tool_decision" && data.call_id === call.call_id);
    expect(decision && decision.decision.approved === false, `tool_decision ${JSON.stringify(decision?.decision)}`);
    const end = turn.find((data) => data.type === "tool_end" && data.call_id === call.call_id);
    expect(end && end.status === "denied", `tool_end status ${end?.status}`);
    expect(!fs.existsSync(path.join(dirs.project, "smoke-approval.txt")), "the rejected command ran");
    const next = state.fake.requests.find((entry) => entry.scenario === "SMOKE_TOOL" && entry.round === 1);
    expect(next && JSON.stringify(next.messages.filter((message) => message.role === "tool")).includes(reject_text), "the model did not get the reject feedback");
    expect(tool_run.status === "done" && tool_run.text === fake.answers.tool, `status ${tool_run.status}, text ${JSON.stringify(tool_run.text)}`);
    expect(tool_run.needs_input.approvals.length === 0 && tool_run.usage.rounds === 2, `needs_input ${JSON.stringify(tool_run.needs_input)}, usage ${JSON.stringify(tool_run.usage)}`);
    return `tool ${end.status}, rounds ${tool_run.usage.rounds}`;
  });
  await check("events resume with the last id without duplicates", async () => {
    const recorded = [...text_events, ...tool_events].filter((event) => event.id && event.type !== "hello");
    const start_at = recorded.findIndex((event) => event.type === "turn.event");
    const last = recorded[start_at].id;
    const expected = recorded.slice(start_at + 1).map((event) => event.id);
    const seen = await read_events(client, { session_id: session.id, last }, (event) => event.id === expected.at(-1), 30_000);
    const ids = seen.filter((event) => event.id && event.type !== "hello").map((event) => event.id);
    const seq = (id) => Number(id.split(".")[1]);
    expect(seen[0]?.type === "hello", `first event ${seen[0]?.type}`);
    expect(new Set(ids).size === ids.length, "the replay repeats an event id");
    expect(ids.every((id, index) => seq(id) > (index === 0 ? seq(last) : seq(ids[index - 1]))), `ids out of order after ${last}: ${ids.join(" ")}`);
    const missing = expected.filter((id) => !ids.includes(id));
    expect(missing.length === 0, `the replay misses ${missing.join(" ")}`);
    const resync = await read_events(client, { session_id: session.id, last: "000000000000.1" }, (event) => event.type === "resync", 10_000);
    expect(resync[0]?.type === "hello" && resync[1]?.type === "resync", `a stale id gave ${resync.map((event) => event.type).join(" ")}`);
    return `${ids.length} replayed after ${last}, a stale id resyncs`;
  });
  await check("no token gives 401, an Origin header 403, a foreign Host 421", async () => {
    const plain = await raw_get(state.vx.url, "/v1/info", {});
    const origin = await raw_get(state.vx.url, "/v1/info", { origin: "http://example.invalid" });
    const host = await raw_get(state.vx.url, "/v1/info", { host: "example.invalid" });
    expect(plain.status === 401 && plain.code === "unauthorized", `no token: ${JSON.stringify(plain)}`);
    expect(origin.status === 403 && origin.code === "forbidden_origin", `origin: ${JSON.stringify(origin)}`);
    expect(host.status === 421 && host.code === "bad_host", `host: ${JSON.stringify(host)}`);
  });
  await check("no window, tray icon or dialog", () => {
    const windows = windows_of(state.pid);
    const shown = windows.filter((entry) => entry.startsWith("visible ") || entry.includes("Electron_NotifyIconHostWindow"));
    expect(shown.length === 0, `windows: ${shown.join(", ")}`);
    return `top-level windows of pid ${state.pid}: ${windows.join(", ") || "none"}`;
  });
  await check("a second instance on the same data dir exits with 3", async () => {
    const args = [dirs.app, "--vx-serve", "--vx-port=0", `--vx-data-dir=${dirs.data}`];
    const second = await start(electron_exe, args, { VANTHEAX_API_TOKEN: randomBytes(32).toString("hex"), OPENROUTER_API_KEY: dummy_key }).wait(60_000, "the second instance");
    expect(second.code === 3, `exit code ${second.code}, stderr ${second.stderr.trim().slice(-400)}`);
    expect(second.stderr.includes('"step":"lock"') && !second.stdout.includes('"vantheax":"ready"'), `stdout ${second.stdout.slice(-300)}, stderr ${second.stderr.trim().slice(-400)}`);
  });
  await check("the instance exits by itself after close() (stdin lease)", async () => {
    await with_timeout(state.vx.close(), 60_000, "close()");
    state.vx = null;
    expect(!alive(state.pid), `pid ${state.pid} still runs`);
    return `pid ${state.pid} ended`;
  });
  await check("CLI text format exits 0 and prints the answer", async () => {
    prepare_exe();
    const run = await run_cli(["SMOKE_TEXT: answer with the scripted text", "--format", "text"]);
    expect(run.code === 0, `exit code ${run.code}, stderr ${run.stderr.trim().slice(-600)}`);
    expect(run.stdout.trim() === fake.answers.text, `stdout ${JSON.stringify(run.stdout)}`);
  });
  await check("CLI json format exits 0 and ends with a result line", async () => {
    const run = await run_cli(["SMOKE_TEXT: answer with the scripted text", "--format", "json"]);
    expect(run.code === 0, `exit code ${run.code}, stderr ${run.stderr.trim().slice(-600)}`);
    const lines = json_lines(run.stdout);
    const last = lines.at(-1);
    expect(last.type === "result" && last.result.status === "done" && last.result.text === fake.answers.text, `last line ${JSON.stringify(last).slice(0, 300)}`);
    expect(lines.slice(0, -1).every((line) => typeof line.type === "string" && line.type !== "result"), "an event line is not an ApiEvent");
    return `${lines.length} lines`;
  });
  await check("CLI error scenario exits 1 and ends with a result line", async () => {
    const run = await run_cli(["SMOKE_ERROR: fail on purpose", "--format", "json"]);
    expect(run.code === 1, `exit code ${run.code}, stderr ${run.stderr.trim().slice(-600)}`);
    const last = json_lines(run.stdout).at(-1);
    expect(last.type === "result" && last.result.status === "failed" && last.result.error?.kind === "bad_request", `last line ${JSON.stringify(last).slice(0, 300)}`);
    return `${last.result.error.kind}: ${last.result.error.message}`;
  });
  await check("no spawned process is left", async () => {
    const deadline = Date.now() + 15_000;
    while (own_pids().length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(own_pids().length === 0, `still running: ${own_pids().join(", ")}`);
    return `${ready_lines().length} instances started, all ended`;
  });
  await check("nothing was written to the user profile", () => {
    const after = profile_snapshot();
    const added = [...after.roaming.filter((name) => !before.roaming.includes(name)), ...after.local.filter((name) => !before.local.includes(name))];
    expect(!before.headless && !after.headless, `%APPDATA%\\VantheaX-headless existed before: ${before.headless}, after: ${after.headless}`);
    expect(added.length === 0, `new entries in %APPDATA% or %LOCALAPPDATA%: ${added.join(", ")}`);
    return `the instances' TEMP got: ${listing(dirs.tmp, 3).join(", ") || "nothing"}`;
  });
};

const main = async () => {
  try {
    await check("build: npm run build and npm run build:sdk", () => {
      run_npm("build");
      run_npm("build:sdk");
      const missing = [path.join(root, "dist-electron", "main.js"), path.join(root, "dist-sdk", "index.js"), cli_js, electron_exe].filter((file) => !fs.existsSync(file));
      expect(missing.length === 0, `missing after the build: ${missing.join(", ")}`);
    });
    const sdk = await import(pathToFileURL(path.join(root, "dist-sdk", "index.js")).href);
    const before = profile_snapshot();
    state.fake = await fake.start_fake_openrouter();
    fs.mkdirSync(dirs.tmp, { recursive: true });
    Object.assign(process.env, { VX_SMOKE_OPENROUTER_URL: state.fake.url, VX_SMOKE_LOG: log_file, TEMP: dirs.tmp, TMP: dirs.tmp });
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
  }
};

await main();
