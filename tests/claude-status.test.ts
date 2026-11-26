import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ClaudeRun } from "../electron/claude/process.ts";
import { claude_login_command, probe_claude_account } from "../electron/claude/status.ts";

const exe = "C:\\Program Files\\VantheaX\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe";

const command = `& '${exe}' auth login --claudeai`;

const quiet = (t: TestContext) => {
  t.mock.method(console, "warn", () => {});
};

const answer = (code: number | null, stdout = "", stderr = "") => {
  const seen: string[][] = [];
  const run = async (args: string[]): Promise<ClaudeRun> => {
    seen.push(args);
    return { code, stdout, stderr };
  };
  return { seen, run };
};

const probe = (code: number | null, stdout = "", stderr = "") => {
  const fake = answer(code, stdout, stderr);
  return { seen: fake.seen, account: probe_claude_account(fake.run, () => exe) };
};

const claude_ai = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "owner@example.invalid",
  orgId: "org",
  orgName: "Org",
  subscriptionType: "max",
  planTier: "max_20x",
  unknownField: { nested: true },
});

test("an exit 0 claude.ai login is signed_in with email and subscription, and the probe asks for the JSON status", async () => {
  const { seen, account } = probe(0, claude_ai);
  assert.deepEqual(await account, {
    status: "signed_in",
    email: "owner@example.invalid",
    subscription: "max",
    auth_method: "claude.ai",
    login_command: command,
    detail: "",
  });
  assert.deepEqual(seen, [["auth", "status", "--json"]]);
});

test("fields with the wrong type count as absent", async () => {
  const account = await probe(0, JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: 42, subscriptionType: ["max"] })).account;
  assert.deepEqual([account.status, account.email, account.subscription], ["signed_in", null, null]);
});

test("an exit 0 login through another method is other_login with that method", async () => {
  for (const method of ["api_key", "oauth_token", "third_party", "api_key_helper"]) {
    const account = await probe(0, JSON.stringify({ loggedIn: true, authMethod: method, apiKeySource: "ANTHROPIC_API_KEY" })).account;
    assert.deepEqual([account.status, account.auth_method, account.login_command], ["other_login", method, command], method);
  }
  const unnamed = await probe(0, JSON.stringify({ loggedIn: true, authMethod: 7 })).account;
  assert.deepEqual([unnamed.status, unnamed.auth_method], ["other_login", null]);
});

test("exit 1 or loggedIn false is signed_out with the login command", async () => {
  for (const [code, stdout] of [
    [1, JSON.stringify({ loggedIn: false, authMethod: "none" })],
    [1, "Not logged in"],
    [1, ""],
    [0, JSON.stringify({ loggedIn: false, authMethod: "none" })],
  ] as const) {
    assert.deepEqual(await probe(code, stdout).account, {
      status: "signed_out",
      email: null,
      subscription: null,
      auth_method: null,
      login_command: command,
      detail: "",
    });
  }
});

test("another exit code is an error with a short detail from stderr", async (t) => {
  quiet(t);
  const failed = await probe(3, "", "Error: config file invalid\n    at somewhere\n").account;
  assert.deepEqual([failed.status, failed.detail, failed.login_command], ["error", "claude auth status exited with code 3: Error: config file invalid", command]);
  const killed = await probe(null).account;
  assert.deepEqual([killed.status, killed.detail], ["error", "claude auth status exited with code none"]);
});

test("unparsable output or output without a login state on exit 0 is an error", async (t) => {
  quiet(t);
  for (const stdout of ["not json at all", "", "[true]", JSON.stringify({ authMethod: "claude.ai" }), JSON.stringify({ loggedIn: "yes" })]) {
    const account = await probe(0, stdout).account;
    assert.equal(account.status, "error", stdout);
    assert.match(account.detail, /^claude auth status printed an unexpected answer: /);
    assert.equal(account.email, null);
  }
});

test("a missing executable or a spawn error is missing without a login command", async (t) => {
  quiet(t);
  const fake = answer(0, claude_ai);
  const absent = await probe_claude_account(fake.run, () => {
    throw new Error("the Claude Code executable is missing at C:\\x\\claude.exe");
  });
  assert.deepEqual(absent, {
    status: "missing",
    email: null,
    subscription: null,
    auth_method: null,
    login_command: "",
    detail: "the Claude Code executable is missing at C:\\x\\claude.exe",
  });
  assert.deepEqual(fake.seen, []);
  const refused = await probe_claude_account(async () => {
    throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
  }, () => exe);
  assert.deepEqual([refused.status, refused.login_command, refused.detail], ["missing", "", "spawn EACCES"]);
});

test("the login command quotes the path for PowerShell and doubles single quotes", () => {
  assert.equal(claude_login_command("C:\\Users\\O'Brien\\claude.exe"), "& 'C:\\Users\\O''Brien\\claude.exe' auth login --claudeai");
  assert.equal(claude_login_command("D:\\a b\\claude.exe"), "& 'D:\\a b\\claude.exe' auth login --claudeai");
});
