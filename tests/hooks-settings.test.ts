import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { parse_hook_fields, parse_hook_scope, normalize_hooks } from "../electron/hooks/validate.ts";
import { add_project, get_settings, init_settings, remove_project, set_project_folder, update_settings } from "../electron/settings/store.ts";
import { default_settings, merge_settings, normalize_settings } from "../electron/settings/validate.ts";
import { hook, plain_codec, temp_root } from "./hooks-kit.ts";

let root = "";

before(async () => {
  root = await temp_root("settings");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const silenced = <T>(work: () => T): { value: T; errors: string[] } => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => errors.push(parts.map(String).join(" "));
  try {
    return { value: work(), errors };
  } finally {
    console.error = original;
  }
};

const fresh_settings = async (name: string, stored: unknown | null = null) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  if (stored !== null) {
    await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify(stored));
  }
  await init_settings({
    files: { settings: path.join(dir, "settings.json"), secrets: path.join(dir, "secrets.json"), legacy_settings: path.join(dir, "missing-legacy.json") },
    codec: plain_codec,
    on_change: () => undefined,
  });
  return dir;
};

test("settings without hooks load with empty hooks and keep everything else", async () => {
  await fresh_settings("no-hooks", { language: "de", mode: "full" });
  assert.deepEqual(get_settings().hooks, { global: [], projects: {} });
  assert.equal(get_settings().language, "de");
  assert.equal(get_settings().mode, "full");
  assert.deepEqual(normalize_settings({}, default_settings()).hooks, { global: [], projects: {} });
  assert.deepEqual(normalize_settings({ hooks: "nope" }, default_settings()).hooks, { global: [], projects: {} });
});

test("normalize_hooks keeps valid hooks and drops each invalid one with a log line", () => {
  const good = hook({ id: "good", matcher: "run_command" });
  const raw = {
    global: [
      good,
      { ...hook({ id: "bad-event" }), event: "SessionStart" },
      hook({ id: "bad-regex", matcher: "(" }),
      hook({ id: "empty-command", command: "   " }),
      hook({ id: "slow", timeout_s: 3601 }),
      hook({ id: "fraction", timeout_s: 1.5 }),
      { ...hook({ id: "good" }), command: "exit 1" },
      { ...hook(), id: "has spaces" },
    ],
    projects: { "D:\\Work\\Repo": [hook({ id: "p1", event: "Stop" })], "d:/work/repo/": [hook({ id: "p2", event: "Stop" })], "D:\\Empty": [] },
  };
  const { value, errors } = silenced(() => normalize_hooks(raw));
  assert.deepEqual(value.global, [good]);
  assert.deepEqual(Object.keys(value.projects), ["D:\\Work\\Repo"]);
  assert.deepEqual(value.projects["D:\\Work\\Repo"]?.map((entry) => entry.id), ["p1", "p2"]);
  assert.equal(errors.length, 7);
  for (const id of ["bad-event", "bad-regex", "empty-command", "slow", "fraction", "good", "has spaces"]) {
    assert.ok(errors.some((line) => line.includes(JSON.stringify(id))), `no log line names ${id}`);
  }
});

test("merge_settings keeps hooks through a round trip and replaces them on a patch", () => {
  const first = hook({ id: "one", event: "UserPromptSubmit", command: "Write-Output hi" });
  const base = merge_settings(default_settings(), { hooks: { global: [first], projects: {} } });
  assert.deepEqual(base.hooks.global, [first]);
  const again = normalize_settings(JSON.parse(JSON.stringify(base)), default_settings());
  assert.deepEqual(again.hooks, base.hooks);
  const other = merge_settings(base, { language: "de" });
  assert.deepEqual(other.hooks, base.hooks);
  const replaced = merge_settings(base, { hooks: { global: [], projects: {} } });
  assert.deepEqual(replaced.hooks.global, []);
});

test("parse_hook_fields fills defaults and rejects each invalid field with its name", () => {
  assert.deepEqual(parse_hook_fields({ event: "Stop", shell: "bash", command: " ./check.sh " }), {
    event: "Stop",
    matcher: "",
    shell: "bash",
    command: "./check.sh",
    timeout_s: 60,
    enabled: true,
  });
  const base = { event: "PreToolUse", shell: "powershell", command: "exit 0" };
  assert.throws(() => parse_hook_fields({ ...base, event: "Notification" }), /event must be one of/);
  assert.throws(() => parse_hook_fields({ ...base, matcher: 3 }), /matcher must be a string/);
  assert.throws(() => parse_hook_fields({ ...base, matcher: "[" }), /matcher is not a valid pattern/);
  assert.throws(() => parse_hook_fields({ ...base, shell: "cmd" }), /shell must be one of/);
  assert.throws(() => parse_hook_fields({ ...base, command: "" }), /command must be a non-empty string/);
  assert.throws(() => parse_hook_fields({ ...base, timeout_s: 0 }), /timeout_s must be a whole number from 1 to 3600/);
  assert.throws(() => parse_hook_fields({ ...base, timeout_s: "60" }), /timeout_s must be a whole number/);
  assert.throws(() => parse_hook_fields({ ...base, enabled: "yes" }), /enabled must be a boolean/);
  assert.throws(() => parse_hook_fields("hook"), /hook must be an object/);
});

test("the IPC scope parser accepts global and listed projects only", () => {
  const known = (value: string) => (value.toLowerCase() === "d:\\work\\repo" ? "D:\\Work\\Repo" : null);
  assert.deepEqual(parse_hook_scope({ kind: "global" }, known), { kind: "global" });
  assert.deepEqual(parse_hook_scope({ kind: "project", path: "d:\\work\\repo" }, known), { kind: "project", path: "D:\\Work\\Repo" });
  assert.throws(() => parse_hook_scope({ kind: "project", path: "C:\\Other" }, known), /not a project in the project list/);
  assert.throws(() => parse_hook_scope({ kind: "project" }, known), /hook scope must be/);
  assert.throws(() => parse_hook_scope({ kind: "everywhere" }, known), /hook scope must be/);
});

test("moving a project folder re-keys its hooks and removing the project drops them", async () => {
  await fresh_settings("projects");
  const old_path = path.join(root, "projects", "old");
  const new_path = path.join(root, "projects", "new");
  await add_project(old_path, "folder-1");
  const kept = hook({ id: "kept", event: "Stop" });
  const global = hook({ id: "global-hook", event: "Stop" });
  await update_settings({ hooks: { global: [global], projects: { [old_path]: [kept] } } });
  await set_project_folder(old_path, { path: new_path, folder_id: "folder-1" });
  assert.deepEqual(get_settings().hooks.projects, { [new_path]: [kept] });
  const stored = JSON.parse(await fs.readFile(path.join(root, "projects", "settings.json"), "utf8"));
  assert.deepEqual(stored.hooks.projects, { [new_path]: [kept] });
  await remove_project(new_path);
  assert.deepEqual(get_settings().hooks, { global: [global], projects: {} });
});
