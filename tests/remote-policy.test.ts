import assert from "node:assert/strict";
import { test } from "node:test";
import { channel_kind } from "../shared/ipc/index.ts";
import { remote_hidden_events, remote_local_channels, remote_refused } from "../shared/remote-policy.ts";

test("every refused channel is a declared invoke or send channel", () => {
  for (const name of remote_refused) {
    const kind = channel_kind(name);
    assert.ok(kind === "invoke" || kind === "send", `${name} is ${kind}`);
  }
});

test("the PC-only channels, the browser dock and the LAN toggle are refused", () => {
  const expected = [
    "window:minimize",
    "window:toggle_maximize",
    "window:close",
    "window:fullscreen",
    "window:zoom",
    "shell:reveal_path",
    "projects:choose",
    "projects:pick_folder",
    "projects:open",
    "mcp:detect_folder",
    "skills:open_folder",
    "files:reveal",
    "browser:tabs",
    "browser:open",
    "browser:viewport",
    "remote:status",
    "remote:set_enabled",
    "remote:renew_link",
  ] as const;
  for (const name of expected) {
    assert.ok(remote_refused.has(name), name);
  }
  for (const name of ["chats:list", "turn:send", "turn:approve", "terminal:input", "settings:update", "attachments:save"] as const) {
    assert.equal(remote_refused.has(name), false, name);
  }
});

test("channels answered on the device are invoke channels the server refuses", () => {
  for (const name of remote_local_channels) {
    assert.equal(channel_kind(name), "invoke", name);
    assert.ok(remote_refused.has(name), name);
  }
});

test("hidden events are declared events and include the pairing status", () => {
  for (const name of remote_hidden_events) {
    assert.equal(channel_kind(name), "event", name);
  }
  assert.ok(remote_hidden_events.has("remote:changed"));
  assert.ok(remote_hidden_events.has("window:changed"));
  assert.equal(remote_hidden_events.has("turn:event"), false);
});

test("the phone may manage scheduled tasks but never sees the PC toast click", () => {
  for (const name of ["scheduled:list", "scheduled:save", "scheduled:set_enabled", "scheduled:remove", "scheduled:run_now"] as const) {
    assert.equal(channel_kind(name), "invoke", name);
    assert.equal(remote_refused.has(name), false, name);
  }
  assert.equal(remote_hidden_events.has("scheduled:open_chat"), true);
  assert.equal(remote_hidden_events.has("scheduled:changed"), false);
});
