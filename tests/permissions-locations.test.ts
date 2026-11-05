import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { create_values, resolved, word_value } from "../electron/permissions/command-values.ts";
import { location_change, start_location } from "../electron/permissions/command-location.ts";
import { shell_words } from "../electron/permissions/shell-words.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fit_actions } from "../electron/permissions/review-sections.ts";
import { trim_steps } from "../electron/permissions/review-budget.ts";
import { command_targets, run_git, target_facts } from "../electron/permissions/target-facts.ts";
import { git, repo_with } from "./git-kit.ts";

const roots: string[] = [];
const root = async () => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vx-permission-")); roots.push(dir); return dir; };
after(async () => { for (const dir of roots) await fs.rm(dir, { recursive: true, force: true }); });
const args = (text: string) => shell_words(text, "posix").map((word) => ({ word, value: word_value(word, create_values({}), "posix") }));

test("unquoted POSIX location globs use their actual single directory match", () => {
  const state = start_location("D:/project");
  const next = location_change("cd", args("sub*"), state, "posix", "cd sub*", () => ["D:\\project\\sub-one"]);
  assert.deepEqual(next?.current, resolved(["D:\\project\\sub-one"]));
});

test("argumentless POSIX pushd swaps the top stack entry instead of changing home", () => {
  const state = { ...start_location("D:/project/sub"), stack: [resolved(["D:\\project"])] };
  const next = location_change("pushd", [], state, "posix", "pushd");
  assert.deepEqual(next?.current, resolved(["D:\\project"]));
  assert.deepEqual(next?.stack, [resolved(["D:\\project\\sub"])]);
});

test("relative PATH directories resolve against the command working directory", async () => {
  const dir = await root();
  await fs.mkdir(path.join(dir, "bin"));
  await fs.writeFile(path.join(dir, "bin", "probe.exe"), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)]));
  const seen = await inspect_command_sources(dir, dir, "probe.exe", { chat_id: "relative-path", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH: "bin", PATHEXT: ".EXE" } });
  assert.equal(seen.programs[0]?.path.toLowerCase(), path.join(dir, "bin", "probe.exe").toLowerCase());
  assert.equal(seen.programs[0]?.kind, "native");
});

test("network PATH entries are reported as an inspection gap instead of silently skipped", async () => {
  const dir = await root();
  const seen = await inspect_command_sources(dir, dir, "probe.exe", { chat_id: "network-path", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH: String.raw`\\server\share\tools`, PATHEXT: ".EXE" } });
  assert.ok(seen.gaps.some((gap) => /network/i.test(gap)), JSON.stringify(seen));
});

test("known cmdlets and aliases do not depend on unresolved or network PATH entries", async () => {
  const dir = await root();
  for (const PATH of [String.raw`\\server\share`, "bin"]) {
    const seen = await inspect_command_sources(dir, dir, "Get-ChildItem; gci", { chat_id: "builtin-path", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH, PATHEXT: ".EXE" } });
    assert.deepEqual(seen.gaps, []);
  }
});

test("resolving PATH does not apply the eight-value expression limit to directory lists", async () => {
  const dir = await root();
  await fs.mkdir(path.join(dir, "bin"));
  await fs.writeFile(path.join(dir, "bin", "probe.exe"), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)]));
  const PATH = ["bin", ...Array.from({ length: 12 }, (_, index) => path.join(dir, "missing" + index))].join(";");
  const seen = await inspect_command_sources(dir, dir, "probe.exe", { chat_id: "many-paths", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH, PATHEXT: ".EXE" } });
  assert.deepEqual(seen.gaps, []);
  assert.equal(seen.programs[0]?.kind, "native");
});

test("trimming actions preserves recent write content when the content fits", () => {
  const line = { key: "write", kind: "write" as const, full: '{"path":"a.txt","text":"recent content"}', text: '{"path":"a.txt","text":"recent content"}', path_only: '{"path":"a.txt"}' };
  const lines = fit_actions([line], trim_steps.indexOf("actions") + 1, 0);
  assert.equal(JSON.parse(lines[0]).text, "recent content");
});

test("second-resolution index timestamps cannot claim a same-second newer file is clean", async () => {
  const dir = await root();
  const git_dir = path.join(dir, ".git");
  await fs.mkdir(git_dir);
  const file = path.join(dir, "file.txt");
  await fs.writeFile(file, "changed!");
  await fs.writeFile(path.join(git_dir, "index"), "fixture");
  const second = Math.floor(Date.now() / 1000) - 60;
  await fs.utimes(file, second + 0.9, second + 0.9);
  await fs.utimes(path.join(git_dir, "index"), second + 0.8, second + 0.8);
  const facts = await target_facts(await command_targets("Remove-Item file.txt", dir, []), { chat_id: "racy-second", chat_started_at: Number.POSITIVE_INFINITY }, async (argv) => argv.includes("--cached") ? `file.txt\0  ctime: ${second}:0\n  mtime: ${second}:0\n  dev: 0 ino: 0\n  uid: 0 gid: 0\n  size: 8 flags: 0\n` : "");
  assert.match(facts[0], /git: tracked, modified$/);
});

test("quoted globs remain literal, ambiguous globs become unknown and empty pushd preserves cwd", () => {
  const state = start_location("D:/project");
  const quoted = location_change("cd", args("'a[1]'"), state, "posix", "cd 'a[1]'", () => ["D:\\project\\a1"]);
  assert.deepEqual(quoted?.current, resolved(["D:\\project\\a[1]"]));
  for (const target of ['a"[1]"', String.raw`a\[1\]`, "$'a[1]'"]) {
    const mixed = location_change("cd", args(target), state, "posix", "cd " + target, () => ["D:\\project\\a1"]);
    assert.deepEqual(mixed?.current, resolved(["D:\\project\\a[1]"]));
  }
  for (const hits of [[], ["D:\\project\\sub-one", "D:\\project\\sub-two"]]) {
    const unknown = location_change("cd", args("sub*"), state, "posix", "cd sub*", () => hits);
    assert.ok(unknown && "unresolved" in unknown.current);
  }
  const empty = location_change("pushd", [], state, "posix", "pushd");
  assert.deepEqual(empty, state);
  const powershell = location_change("pushd", [], state, "powershell", "pushd");
  assert.deepEqual(powershell?.current, state.current);
  assert.deepEqual(powershell?.stack, [state.current]);
});

test("UNC PATH precedence is explicit without probing any network directory", async (t) => {
  const dir = await root();
  await fs.mkdir(path.join(dir, "bin"));
  const local = path.join(dir, "bin", "probe.exe");
  await fs.writeFile(local, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)]));
  const stat = fs.stat.bind(fs);
  const reads: string[] = [];
  t.mock.method(fs, "stat", async (...argv: Parameters<typeof fs.stat>) => {
    reads.push(String(argv[0]));
    return Reflect.apply(stat, fs, argv);
  });
  const inspect = (PATH: string) => inspect_command_sources(dir, dir, "probe.exe", { chat_id: "path-order", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH, PATHEXT: ".EXE" } });
  const earlier = await inspect(String.raw`\\server\share` + ";bin");
  assert.ok(earlier.gaps.some((line) => /network PATH/.test(line)));
  const later = await inspect("bin;" + String.raw`\\server\share`);
  assert.deepEqual(later.gaps, []);
  assert.equal(later.programs[0]?.path, local);
  assert.equal(reads.some((file) => file.startsWith("\\\\")), false);
});

test("action reduction retains recent write text before falling back to path-only metadata", () => {
  const actions = Array.from({ length: 30 }, (_, index) => ({ key: String(index), kind: "write" as const, full: "full", text: JSON.stringify({ path: index + ".txt", text: index === 29 ? "LAST-WRITE" : "x".repeat(1800) }), path_only: JSON.stringify({ path: index + ".txt" }) }));
  const fit = fit_actions(actions, trim_steps.indexOf("actions") + 1, 4);
  assert.ok(fit.some((line) => line.includes("LAST-WRITE")));
  assert.ok(Buffer.byteLength(fit.join("\n")) <= 40000);
  const huge = fit_actions(actions.map((line) => ({ ...line, text: "x".repeat(45000) })), trim_steps.indexOf("actions") + 1, 4);
  assert.ok(huge.every((line) => line.length < 1000));
});

test("native Git preserves whole-second file times and Bash confirms glob/pushd cwd", async () => {
  const dir = await repo_with("native-location", { "tracked.txt": "before!!" });
  const second = Math.floor(Date.now() / 1000) - 60;
  const file = path.join(dir, "tracked.txt");
  await fs.utimes(file, second, second);
  git(dir, "add", "tracked.txt");
  const debug = git(dir, "ls-files", "--debug", "tracked.txt");
  assert.match(debug, /mtime: \d+:0\r?\n/);
  await fs.writeFile(file, "changed!");
  await fs.utimes(file, second + 0.9, second + 0.9);
  await fs.utimes(path.join(dir, ".git", "index"), second + 0.8, second + 0.8);
  assert.equal(git(dir, "--no-optional-locks", "diff", "--name-only").trim(), "tracked.txt");
  const facts = await target_facts(await command_targets("Remove-Item tracked.txt", dir, []), { chat_id: "native-racy", chat_started_at: Number.POSITIVE_INFINITY }, run_git);
  assert.match(facts[0], /git: tracked, modified$/);
  await fs.mkdir(path.join(dir, "sub-one"));
  const bash = "C:/Program Files/Git/bin/bash.exe";
  const native = spawnSync(bash, ["--noprofile", "--norc", "-c", "cd sub*; printf 'GLOB='; pwd -W; pushd .. >/dev/null; pushd >/dev/null; printf 'SWAP='; pwd -W"], { cwd: dir, encoding: "utf8" });
  assert.equal(native.status, 0, native.stderr);
  const expected = path.join(dir, "sub-one").replaceAll("\\", "/");
  assert.equal(native.stdout.replaceAll("\r", ""), `GLOB=${expected}\nSWAP=${expected}\n`);
});
