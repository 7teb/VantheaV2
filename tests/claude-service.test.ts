import assert from "node:assert/strict";
import { test } from "node:test";
import { claude_account, init_claude, refresh_claude_account } from "../electron/claude/service.ts";
import type { ClaudeAccount } from "../shared/claude.ts";

const account = (patch: Partial<ClaudeAccount>): ClaudeAccount => ({
  status: "signed_out",
  email: null,
  subscription: null,
  auth_method: null,
  login_command: "& 'C:\\x\\claude.exe' auth login --claudeai",
  detail: "",
  ...patch,
});

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

test("the account is unknown before the first probe and after init", () => {
  init_claude({ changed: () => {}, probe: () => Promise.reject(new Error("not called")) });
  assert.equal(claude_account().status, "unknown");
  assert.equal(claude_account().login_command, "");
});

test("concurrent refreshes share one probe, the result is stored and passed to changed", async () => {
  const changed: ClaudeAccount[] = [];
  const pending = deferred<ClaudeAccount>();
  let probes = 0;
  init_claude({
    changed: (next) => changed.push(next),
    probe: () => {
      probes += 1;
      return pending.promise;
    },
  });
  const first = refresh_claude_account();
  const second = refresh_claude_account();
  assert.equal(first, second);
  assert.equal(probes, 1);
  assert.equal(claude_account().status, "unknown");
  const signed_in = account({ status: "signed_in", email: "owner@example.invalid", subscription: "max", auth_method: "claude.ai" });
  pending.resolve(signed_in);
  assert.deepEqual(await first, signed_in);
  assert.deepEqual(await second, signed_in);
  assert.deepEqual(claude_account(), signed_in);
  assert.deepEqual(changed, [signed_in]);
});

test("a refresh after the shared probe settled starts a new probe and reports every result", async () => {
  const changed: ClaudeAccount[] = [];
  const answers = [account({ status: "signed_out" }), account({ status: "signed_in", auth_method: "claude.ai" })];
  let probes = 0;
  init_claude({
    changed: (next) => changed.push(next),
    probe: async () => answers[probes++],
  });
  assert.equal((await refresh_claude_account()).status, "signed_out");
  assert.equal((await refresh_claude_account()).status, "signed_in");
  assert.equal(probes, 2);
  assert.deepEqual(changed.map((entry) => entry.status), ["signed_out", "signed_in"]);
  assert.equal(claude_account().status, "signed_in");
});

test("a failed probe rejects every waiting caller, keeps the last account and lets the next refresh probe again", async () => {
  const changed: ClaudeAccount[] = [];
  const pending = deferred<ClaudeAccount>();
  let probes = 0;
  init_claude({
    changed: (next) => changed.push(next),
    probe: () => {
      probes += 1;
      return probes === 1 ? pending.promise : Promise.resolve(account({ status: "missing", login_command: "" }));
    },
  });
  const first = refresh_claude_account();
  const second = refresh_claude_account();
  pending.reject(new Error("probe broke"));
  await assert.rejects(first, /probe broke/);
  await assert.rejects(second, /probe broke/);
  assert.equal(claude_account().status, "unknown");
  assert.deepEqual(changed, []);
  assert.equal((await refresh_claude_account()).status, "missing");
  assert.equal(probes, 2);
});
