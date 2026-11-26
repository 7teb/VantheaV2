import assert from "node:assert/strict";
import { test } from "node:test";
import type { McpServerConfig } from "../shared/settings.ts";
import { observe_servers } from "../electron/mcp/client.ts";
import { has_grant, is_trusted, record_grant, set_server_trust, type GrantTarget } from "../electron/mcp/grants.ts";

const config = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({ command: "node", args: ["server.js"], cwd: "C:/srv", env: { PORT: "1" }, enabled: true, ...over });

const memory: GrantTarget = { server: "mem", tool: "write_memory", tier: "dangerous", scope: null };

const other: GrantTarget = { server: "other", tool: "write_memory", tier: "dangerous", scope: null };

test("a server replaced under the same name loses its chat grants and trust, a plain toggle keeps them", () => {
  observe_servers({ mem: config(), other: config({ cwd: "C:/other" }) });
  record_grant("chat-1", memory, "session");
  record_grant("chat-2", memory, "session");
  record_grant("chat-1", other, "session");
  set_server_trust("mem", true);
  observe_servers({ mem: config({ enabled: false }), other: config({ cwd: "C:/other" }) });
  assert.equal(has_grant("chat-1", memory), true);
  assert.equal(is_trusted("mem"), true);
  observe_servers({ mem: config({ env: { PORT: "2" } }), other: config({ cwd: "C:/other" }) });
  assert.equal(has_grant("chat-1", memory), false);
  assert.equal(has_grant("chat-2", memory), false);
  assert.equal(is_trusted("mem"), false);
  assert.equal(has_grant("chat-1", other), true);
});

test("a removed server loses its grants and the same name added again starts without them", () => {
  observe_servers({ mem: config() });
  record_grant("chat-1", memory, "session");
  observe_servers({});
  assert.equal(has_grant("chat-1", memory), false);
  observe_servers({ mem: config() });
  assert.equal(has_grant("chat-1", memory), false);
});
