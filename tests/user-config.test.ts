import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { default_max_running_agents, ensure_user_config, max_running_agents, user_config_file } from "../electron/settings/user-config.ts";

let home = "";

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "vx-user-config-"));
});

after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

test("the config lives in .VantheaX under the home folder and starts with a limit of 20", () => {
  const file = user_config_file(home);
  assert.equal(file, path.join(home, ".VantheaX", "config.json"));
  assert.equal(max_running_agents(file), default_max_running_agents);
  ensure_user_config(file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { max_running_agents: 20 });
  assert.equal(max_running_agents(file), 20);
});

test("a changed limit is read on the next check and an existing file is never overwritten", () => {
  const file = user_config_file(home);
  ensure_user_config(file);
  fs.writeFileSync(file, `﻿${JSON.stringify({ max_running_agents: 45 })}`);
  assert.equal(max_running_agents(file), 45);
  ensure_user_config(file);
  assert.equal(max_running_agents(file), 45);
});

test("an invalid file or value falls back to 20", () => {
  const file = user_config_file(home);
  for (const text of ["not json", "null", JSON.stringify({ max_running_agents: 0 }), JSON.stringify({ max_running_agents: 2.5 }), JSON.stringify({ max_running_agents: "40" }), JSON.stringify({})]) {
    fs.writeFileSync(file, text);
    assert.equal(max_running_agents(file), 20, text);
  }
});
