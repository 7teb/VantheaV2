import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { prompt_hooks, turn_hooks } from "../electron/hooks/turn-hooks.ts";
import { save_hook } from "../electron/hooks/store.ts";
import { add_project } from "../electron/settings/store.ts";
import { identity_kit, ps_path, start_settings, temp_root } from "./hooks-kit.ts";

let root = "";
let project = "";
let marker = "";

before(async () => {
  root = await temp_root("project-files");
  project = path.join(root, "cloned-repo");
  marker = path.join(root, "marker.txt");
  await fs.mkdir(path.join(project, ".claude"), { recursive: true });
  await fs.mkdir(path.join(project, ".vantheax"), { recursive: true });
  await start_settings(root);
  await add_project(project, "folder-clone");
  const planted = `New-Item -ItemType File -Force -Path '${ps_path(marker)}' | Out-Null`;
  const claude = { hooks: { PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: planted }] }], UserPromptSubmit: [{ hooks: [{ type: "command", command: planted }] }] } };
  await fs.writeFile(path.join(project, ".claude", "settings.json"), JSON.stringify(claude));
  await fs.writeFile(path.join(project, ".claude", "settings.local.json"), JSON.stringify(claude));
  await fs.writeFile(path.join(project, ".vantheax", "hooks.json"), JSON.stringify({ global: [{ id: "planted", event: "PreToolUse", matcher: "", shell: "powershell", command: planted, timeout_s: 60, enabled: true }], projects: {} }));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

const call = { name: "run_command", args: { command: "git status" }, tool_use_id: "call_files_c0_0" };

test("hook files inside a project folder never run", async () => {
  const kit = identity_kit(project, { project_path: project });
  const hooks = turn_hooks(kit.identity);
  assert.deepEqual(await hooks.pre_tool(call), { kind: "run", runs: [] });
  assert.deepEqual(await prompt_hooks(kit.identity, "hello", "user"), { kind: "go", notes: [] });
  assert.equal(await exists(marker), false);
});

test("a hook saved in VantheaX's own settings for that project runs", async () => {
  const command = `New-Item -ItemType File -Force -Path '${ps_path(marker)}' | Out-Null`;
  await save_hook({ kind: "project", path: project }, { event: "PreToolUse", matcher: "run_command", shell: "powershell", command, timeout_s: 60, enabled: true }, null);
  await turn_hooks(identity_kit(project, { project_path: project }).identity).pre_tool(call);
  assert.equal(await exists(marker), true);
});
