import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { RunResult, SessionInfo } from "../shared/api/contract.ts";
import {
  compose_message,
  reads_stdin,
  error_line,
  event_line,
  exit_code,
  file_mime,
  latest_session,
  parse_cli,
  result_line,
  result_notes,
  type CliOptions,
} from "../sdk/cli-args.ts";
import { account_info, json_body, start_stub } from "./sdk-client-kit.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fake = path.join(root, "tests", "support", "fake-headless.mjs");
const cli = path.join(root, "sdk", "cli.ts");

const defaults: CliOptions = {
  message: [],
  cwd: null,
  model: null,
  effort: null,
  mode: null,
  session: null,
  continue_latest: false,
  files: [],
  format: "text",
  exe: null,
  data_dir: null,
  server: null,
};

const result_of = (patch: Partial<RunResult> = {}, needs: Partial<RunResult["needs_input"]> = {}): RunResult => ({
  run_id: "m1",
  session_id: "s1",
  status: "done",
  error: null,
  text: "answer",
  messages: [],
  active: { turn: false, agents: 0, workflows: 0, background: 0, queued: 0 },
  changed_files: [],
  usage: { prompt_tokens: 1, completion_tokens: 1, reasoning_tokens: 0, cached_tokens: 0, cache_write_tokens: 0, rounds: 1 },
  started_at: "2026-11-20T12:00:00.000Z",
  ended_at: "2026-11-20T12:00:01.000Z",
  ...patch,
  needs_input: { questions: [], approvals: [], plan_message_id: null, ...needs },
});

test("parse_cli reads every flag in both spellings", () => {
  const parsed = parse_cli([
    "run",
    "fix",
    "the",
    "test",
    "--cwd",
    "D:/proj",
    "--model=a/b",
    "--effort",
    "high",
    "--mode",
    "full",
    "--file",
    "a.txt",
    "--file=b.png",
    "--format",
    "json",
    "--exe",
    "C:/VantheaX/VantheaX.exe",
    "--data-dir=D:/data",
  ]);
  assert.deepEqual(parsed, {
    kind: "ok",
    options: {
      ...defaults,
      message: ["fix", "the", "test"],
      cwd: "D:/proj",
      model: "a/b",
      effort: "high",
      mode: "full",
      files: ["a.txt", "b.png"],
      format: "json",
      exe: "C:/VantheaX/VantheaX.exe",
      data_dir: "D:/data",
    },
  });
  assert.deepEqual(parse_cli(["run", "go", "--session=chat_1", "--server", "http://127.0.0.1:4000"]), {
    kind: "ok",
    options: { ...defaults, message: ["go"], session: "chat_1", server: "http://127.0.0.1:4000" },
  });
  assert.deepEqual(parse_cli(["run", "--continue"]), { kind: "ok", options: { ...defaults, continue_latest: true } });
});

test("parse_cli answers --help and -h as a command or as a flag", () => {
  for (const argv of [["--help"], ["-h"], ["run", "--help"], ["run", "fix", "it", "-h", "--format", "json"], ["exec", "--help"]]) {
    assert.deepEqual(parse_cli(argv), { kind: "help" }, argv.join(" "));
  }
});

test("parse_cli refuses flags that a session or a server would ignore", () => {
  for (const argv of [
    ["run", "x", "--cwd", "D:/other", "--session", "chat_1"],
    ["run", "x", "--continue", "--cwd=D:/other"],
  ]) {
    const parsed = parse_cli(argv);
    assert.equal(parsed.kind === "error" && parsed.message, "--cwd only applies to a new session and cannot be combined with --session or --continue", argv.join(" "));
  }
  for (const argv of [
    ["run", "x", "--server", "http://127.0.0.1:4000", "--exe", "C:/VantheaX/VantheaX.exe"],
    ["run", "x", "--data-dir", "D:/data", "--server=http://127.0.0.1:4000"],
  ]) {
    const parsed = parse_cli(argv);
    assert.equal(parsed.kind === "error" && parsed.message, "--exe and --data-dir start a private instance and cannot be combined with --server", argv.join(" "));
  }
});

test("parse_cli rejects unknown flags, bad values and conflicting session flags", () => {
  const message = (argv: string[]) => {
    const parsed = parse_cli(argv);
    assert.equal(parsed.kind, "error");
    return parsed.kind === "error" ? `${parsed.format}: ${parsed.message}` : "";
  };
  assert.equal(message([]), "text: missing command");
  assert.equal(message(["exec", "x"]), "text: unknown command exec");
  assert.equal(message(["run", "--yes"]), "text: unknown flag --yes");
  assert.equal(message(["run", "--mode", "yolo"]), "text: --mode must be one of ask, auto, full, got yolo");
  assert.equal(message(["run", "--format", "xml"]), "text: --format must be text or json, got xml");
  assert.equal(message(["run", "--session", "a", "--continue", "--format=json"]), "json: --session and --continue cannot be combined");
  assert.equal(message(["run", "--model"]), "text: --model needs a value");
  assert.equal(message(["run", "--model", "--continue"]), "text: --model needs a value");
  assert.equal(message(["run", "--continue=yes"]), "text: --continue takes no value");
  assert.equal(message(["run", "--format", "json", "--bogus"]), "json: unknown flag --bogus");
});

test("parse_cli reads the account commands with their switches and connection flags", () => {
  const connection = { format: "text", exe: null, data_dir: null, server: null };
  assert.deepEqual(parse_cli(["account"]), { kind: "account", options: { ...connection, command: { name: "account" } } });
  assert.deepEqual(parse_cli(["billing", "chatgpt", "--server", "http://127.0.0.1:4000"]), {
    kind: "account",
    options: { ...connection, server: "http://127.0.0.1:4000", command: { name: "billing", billing: "chatgpt" } },
  });
  assert.deepEqual(parse_cli(["sign-in", "--consent", "--data-dir=D:/data", "--format", "json"]), {
    kind: "account",
    options: { ...connection, format: "json", data_dir: "D:/data", command: { name: "sign-in", fresh: false, consent: true } },
  });
  assert.deepEqual(parse_cli(["sign-in", "--fresh", "--exe", "C:/VantheaX/VantheaX.exe"]), {
    kind: "account",
    options: { ...connection, exe: "C:/VantheaX/VantheaX.exe", command: { name: "sign-in", fresh: true, consent: false } },
  });
  assert.deepEqual(parse_cli(["sign-out"]), { kind: "account", options: { ...connection, command: { name: "sign-out" } } });
  assert.deepEqual(parse_cli(["sign-in", "--help"]), { kind: "help" });
  assert.deepEqual(parse_cli(["claude-billing", "claude", "--format", "json"]), { kind: "account", options: { ...connection, format: "json", command: { name: "claude-billing", billing: "claude" } } });
  assert.deepEqual(parse_cli(["claude", "--server", "http://127.0.0.1:4000"]), { kind: "account", options: { ...connection, server: "http://127.0.0.1:4000", command: { name: "claude" } } });
});

test("parse_cli rejects account commands with wrong arguments, flags or connections", () => {
  const message = (argv: string[]) => {
    const parsed = parse_cli(argv);
    return parsed.kind === "error" ? `${parsed.format}: ${parsed.message}` : `parsed ${parsed.kind}`;
  };
  assert.equal(message(["billing"]), "text: billing needs exactly one of api, chatgpt");
  assert.equal(message(["billing", "free"]), "text: billing needs exactly one of api, chatgpt");
  assert.equal(message(["billing", "api", "chatgpt", "--format=json"]), "json: billing needs exactly one of api, chatgpt");
  assert.equal(message(["account", "now"]), "text: account takes no arguments, got now");
  assert.equal(message(["sign-out", "--fresh"]), "text: unknown flag --fresh");
  assert.equal(message(["sign-in", "--consent=yes"]), "text: --consent takes no value");
  assert.equal(message(["sign-in", "--model", "a/b"]), "text: unknown flag --model");
  assert.equal(message(["account", "--server"]), "text: --server needs a value");
  assert.equal(message(["account", "--format", "xml"]), "text: --format must be text or json, got xml");
  assert.equal(message(["sign-out", "--server", "http://127.0.0.1:4000", "--data-dir", "D:/data"]), "text: --exe and --data-dir start a private instance and cannot be combined with --server");
  assert.equal(message(["claude-billing"]), "text: claude-billing needs exactly one of api, claude");
  assert.equal(message(["claude-billing", "chatgpt"]), "text: claude-billing needs exactly one of api, claude");
  assert.equal(message(["claude", "now"]), "text: claude takes no arguments, got now");
  assert.equal(message(["claude", "--consent"]), "text: unknown flag --consent");
});

test("stdin is read only without a message or with -, and the dash never reaches the message", () => {
  assert.equal(reads_stdin([]), true);
  assert.equal(reads_stdin(["fix", "it"]), false);
  assert.equal(reads_stdin(["review", "-"]), true);
  assert.equal(compose_message(["review", "-"], "diff\n"), "review\n\ndiff");
  assert.equal(compose_message(["fix", "it"], null), "fix it");
  assert.equal(compose_message(["fix", "it"], "  \n"), "fix it");
  assert.equal(compose_message(["review"], "diff --git a b\n+line\n"), "review\n\ndiff --git a b\n+line");
  assert.equal(compose_message([], "only stdin\n"), "only stdin");
  assert.equal(compose_message([], null), "");
});

test("exit_code is 0 only for a done run that needs nothing", () => {
  assert.equal(exit_code(result_of()), 0);
  assert.equal(exit_code(result_of({ status: "failed", error: { kind: "credits", message: "no credits" } })), 1);
  assert.equal(exit_code(result_of({ status: "stopped" })), 1);
  assert.equal(exit_code(result_of({}, { questions: [{ id: "q", title: "Which?", options: [], message_id: "m1", call_id: "c", index: 0 }] })), 1);
  assert.equal(exit_code(result_of({}, { plan_message_id: "m1" })), 1);
  const approval = {
    approval_id: "m:request-1",
    source: "main" as const,
    agent_id: null,
    run_id: null,
    call_id: "c",
    request: { kind: "memory" as const, action: "remember" as const, text: "x", request_id: "request-1" },
  };
  assert.equal(exit_code(result_of({}, { approvals: [approval] })), 1);
  assert.deepEqual(result_notes(result_of({ status: "failed", error: { kind: "credits", message: "no credits" } }, { plan_message_id: "m1" })), [
    "status: failed (credits: no credits)",
    "plan waits for acceptance: m1",
  ]);
});

test("NDJSON lines are one JSON value per line", () => {
  const event = { type: "ping" as const, id: null, data: null };
  assert.equal(event_line(event), '{"type":"ping","id":null,"data":null}\n');
  const line = result_line(result_of({ text: "two\nlines" }));
  assert.equal(line.split("\n").length, 2);
  assert.deepEqual(JSON.parse(line), { type: "result", result: result_of({ text: "two\nlines" }) });
  assert.deepEqual(JSON.parse(error_line("launch", "no exe")), { type: "error", error: { code: "launch", message: "no exe" } });
});

test("latest_session and file_mime pick the newest session and image types", () => {
  const session = (id: string, updated_at: string) => ({ id, updated_at }) as SessionInfo;
  assert.equal(latest_session([session("a", "2026-11-19T10:00:00.000Z"), session("b", "2026-11-20T09:00:00.000Z"), session("c", "2026-11-18T10:00:00.000Z")])?.id, "b");
  assert.equal(latest_session([]), null);
  assert.equal(file_mime("shot.PNG"), "image/png");
  assert.equal(file_mime("photo.jpeg"), "image/jpeg");
  assert.equal(file_mime("notes.md"), "application/octet-stream");
  assert.equal(file_mime("png"), "application/octet-stream");
});

const server = { url: "", token: randomBytes(32).toString("hex"), child: null as ChildProcessWithoutNullStreams | null, temp: "" };

before(async () => {
  server.temp = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-headless-cli-"));
  const child = spawn(process.execPath, [fake, "--vx-serve", "--vx-lease=stdin"], { env: { ...process.env, VANTHEAX_API_TOKEN: server.token } });
  server.child = child;
  server.url = await new Promise<string>((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`fake headless exited with ${code}`)));
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (line.startsWith('{"vantheax":"ready"')) {
        resolve(JSON.parse(line).url);
      }
    });
  });
});

after(async () => {
  const child = server.child;
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.stdin.end();
    await exited;
  }
  await fs.rm(server.temp, { recursive: true, force: true });
});

type CliRun = { code: number | null; stdout: string; stderr: string };

const run_cli = (args: string[], options: { stdin?: string; token?: string | null } = {}): Promise<CliRun> =>
  new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, VANTHEAX_API_TOKEN: server.token };
    if (options.token === null) {
      delete env.VANTHEAX_API_TOKEN;
    }
    const child = spawn(process.execPath, [cli, ...args], { cwd: server.temp, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (text: string) => (stdout += text));
    child.stderr.setEncoding("utf8").on("data", (text: string) => (stderr += text));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(options.stdin ?? "");
  });

const fake_state = async (): Promise<{ prompts: { session_id: string; body: Record<string, unknown> }[]; uploads: { name: string; mime: string; text: string }[] }> =>
  (await fetch(`${server.url}/fake/state`)).json() as never;

test("the CLI prints NDJSON events and the result line against a running server", async () => {
  const run = await run_cli(["run", "hello", "world", "--server", server.url, "--format", "json", "--mode", "full", "--model", "fake/model"]);
  assert.equal(run.code, 0, run.stderr);
  const lines = run.stdout.trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines[0].type, "hello");
  assert.ok(lines.some((line) => line.type === "turn.event" && line.data.type === "end"));
  assert.ok(lines.some((line) => line.type === "run.settled"));
  const last = lines.at(-1);
  assert.equal(last.type, "result");
  assert.equal(last.result.text, "fake answer: hello world");
  assert.equal(last.result.status, "done");
  const prompt = (await fake_state()).prompts.at(-1);
  assert.deepEqual(prompt?.body, { text: "hello world", model: "fake/model", mode: "full", approvals: "reject" });
});

test("the CLI appends piped stdin, prints the answer and tool progress", async () => {
  const run = await run_cli(["run", "summarize", "-", "--server", server.url], { stdin: "piped text\n" });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, "fake answer: summarize\n\npiped text\n");
  assert.match(run.stderr, /tool: read_file/);
});

test("the CLI ignores an open stdin pipe when the message comes as arguments", async () => {
  const run = await run_cli(["run", "summarize", "--server", server.url], { stdin: "piped text\n" });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, "fake answer: summarize\n");
});

test("the CLI exits 1 when the run needs input and reports it on stderr", async () => {
  const run = await run_cli(["run", "please ask me", "--server", server.url]);
  assert.equal(run.code, 1);
  assert.equal(run.stdout, "fake answer: please ask me\n");
  assert.match(run.stderr, /question: Which file\?/);
});

test("the CLI uploads files and continues the most recent session", async () => {
  const file = path.join(server.temp, "notes.txt");
  await fs.writeFile(file, "file body");
  const first = await run_cli(["run", "read", "the", "file", "--file", file, "--server", server.url]);
  assert.equal(first.code, 0, first.stderr);
  const state = await fake_state();
  const upload = state.uploads.at(-1);
  assert.deepEqual(upload && { name: upload.name, mime: upload.mime, text: upload.text }, { name: "notes.txt", mime: "application/octet-stream", text: "file body" });
  const prompt = state.prompts.at(-1);
  assert.deepEqual(prompt?.body.attachment_ids, ["att_1_fake.txt"]);
  const second = await run_cli(["run", "and", "again", "--continue", "--server", server.url]);
  assert.equal(second.code, 0, second.stderr);
  assert.equal((await fake_state()).prompts.at(-1)?.session_id, prompt?.session_id);
});

test("the CLI exits 2 with an error line for rejected prompts and usage errors", async () => {
  const rejected = await run_cli(["run", "x", "--model", "bogus/model", "--server", server.url, "--format", "json"]);
  assert.equal(rejected.code, 2);
  assert.deepEqual(JSON.parse(rejected.stdout.trimEnd().split("\n").at(-1) ?? ""), {
    type: "error",
    error: { code: "unknown_model", message: "unknown model bogus/model" },
  });
  const help = await run_cli(["run", "--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^usage: vantheax run /);
  assert.match(help.stdout, /vantheax claude-billing api\|claude .*\n.*vantheax claude \[--format/);
  const usage = await run_cli(["run", "--format", "json", "--nope"]);
  assert.equal(usage.code, 2);
  assert.deepEqual(JSON.parse(usage.stdout), { type: "error", error: { code: "usage", message: "unknown flag --nope" } });
  const missing_token = await run_cli(["run", "x", "--server", server.url], { token: null });
  assert.equal(missing_token.code, 2);
  assert.match(missing_token.stderr, /VANTHEAX_API_TOKEN/);
  const empty = await run_cli(["run", "--server", server.url]);
  assert.equal(empty.code, 2);
  assert.match(empty.stderr, /no message/);
  const no_session = await run_cli(["run", "x", "--session", "chat_missing", "--server", server.url]);
  assert.equal(no_session.code, 2);
  assert.match(no_session.stderr, /not found/);
});

test("the CLI signs in through a running server and follows the event stream to the result", async () => {
  const { stub, base_url, close } = await start_stub();
  stub.replies.set("POST /v1/account/chatgpt/sign_in", { status: 200, body: account_info("chatgpt", { status: "signing_in" }) });
  stub.replies.set("GET /v1/account", { status: 200, body: account_info("chatgpt", { status: "signed_in", email: "owner@example.invalid", plan_enabled: true }) });
  stub.on_request = (seen) => {
    if (seen.path === "/v1/account/chatgpt/sign_in") {
      stub.push("account.changed", account_info("chatgpt", { status: "signing_in" }).chatgpt, "b.1");
      stub.push("account.changed", account_info("chatgpt", { status: "signed_in", email: "owner@example.invalid", plan_enabled: true }).chatgpt, "b.2");
    }
  };
  try {
    const signed = await run_cli(["sign-in", "--fresh", "--server", base_url]);
    assert.equal(signed.code, 0, signed.stderr);
    assert.equal(signed.stdout, "signed in to ChatGPT as owner@example.invalid\n");
    assert.match(signed.stderr, /the ChatGPT sign-in page was opened in the browser of the machine that runs VantheaX/);
    assert.deepEqual(json_body(stub.seen.find((seen) => seen.path === "/v1/account/chatgpt/sign_in")), { fresh: true, consent: false });
    const shown = await run_cli(["account", "--server", base_url, "--format", "json"]);
    assert.equal(shown.code, 0, shown.stderr);
    assert.deepEqual(JSON.parse(shown.stdout), { type: "account", account: account_info("chatgpt", { status: "signed_in", email: "owner@example.invalid", plan_enabled: true }) });
    const missing_token = await run_cli(["sign-out", "--server", base_url], { token: null });
    assert.equal(missing_token.code, 2);
    assert.match(missing_token.stderr, /VANTHEAX_API_TOKEN/);
    const refused = await run_cli(["billing", "api", "--server", base_url]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /^vantheax: POST \/v1\/account\/billing/);
    const claude = { status: "signed_out", email: null, subscription: null, auth_method: null, login_command: "& 'C:/x/claude.exe' auth login --claudeai", detail: "" };
    stub.replies.set("POST /v1/account/claude/refresh", { status: 200, body: { ...account_info("api"), claude_billing: "claude", claude } });
    const checked = await run_cli(["claude", "--server", base_url]);
    assert.deepEqual([checked.code, checked.stdout], [1, "claude: signed_out\n"]);
    assert.match(checked.stderr, /run this in PowerShell on the machine that runs VantheaX: & 'C:\/x\/claude\.exe' auth login --claudeai/);
  } finally {
    await close();
  }
});
