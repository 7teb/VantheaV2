import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { command_targets, program_lines, run_git, target_facts, type GitRunner } from "../electron/permissions/target-facts.ts";
import { file_sha256 } from "../electron/permissions/source-read.ts";
import { forget_chat_writes, record_write } from "../electron/permissions/written-files.ts";

const roots: string[] = [];

const has_git = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch (error) {
    console.warn(`[test] git is not on PATH, target-facts git cases are skipped: ${String(error)}`);
    return false;
  }
})();

after(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

const untouched = { chat_id: "c-facts", chat_started_at: Number.POSITIVE_INFINITY };

test("the git reads carry no-optional-locks and fsmonitor off, and a failure becomes one line", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-args-"));
  roots.push(root);
  await fs.mkdir(path.join(root, ".git"));
  await fs.writeFile(path.join(root, "a.txt"), "a");
  const calls: string[][] = [];
  const failing: GitRunner = async (args) => {
    calls.push(args);
    throw new Error("fatal: not a git repository");
  };
  const lines = await target_facts(await command_targets("Remove-Item a.txt", root, []), untouched, failing);
  assert.equal(calls.length, 2);
  for (const args of calls) assert.deepEqual(args.slice(0, 3), ["--no-optional-locks", "-c", "core.fsmonitor=false"]);
  assert.match(lines[0] ?? "", /^a\.txt: .*a\.txt, file, 1 bytes, git facts unavailable: fatal: not a git repository$/);
});

test("targets resolve literal paths, same-command assignments, and list the rest as unresolved", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-targets-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "dist"));
  const list = await command_targets("$out = 'dist'; Remove-Item -Recurse -Force $out; Copy-Item src/a.ts $dest\\x; robocopy dist \\\\server\\share", root, []);
  assert.deepEqual(list.targets.map((target) => target.written), ["$out", "src/a.ts", "\\\\server\\share"]);
  assert.deepEqual(list.unresolved, ["$dest\\x"]);
  const lines = await target_facts(list, untouched, async () => "");
  assert.match(lines.find((line) => line.startsWith("\\\\server")) ?? "", /network or remote location, not read$/);
  assert.match(lines.at(-1) ?? "", /^unresolved: \$dest\\x$/);
});

test("environment references in target paths resolve from process.env, and what stays dynamic is unresolved", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-env-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "cfg"));
  await fs.writeFile(path.join(root, "cfg", "settings.json"), "{}");
  process.env.VX_FACTS_HOME = root;
  process.env.VX_FACTS_LIST = `${root}${path.delimiter}${root}`;
  delete process.env.VX_FACTS_UNSET;
  try {
    const command = [
      'Set-Content "$env:VX_FACTS_HOME\\cfg\\settings.json" x',
      "Remove-Item ${env:VX_FACTS_HOME}\\cfg",
      "cmd /c del %vx_facts_home%\\cfg\\b.txt",
      "Copy-Item $ENV:Vx_Facts_Home\\c.txt $env:VX_FACTS_UNSET\\y %VX_FACTS_HOME%\\$name $env:VX_FACTS_LIST\\z",
    ].join("; ");
    const list = await command_targets(command, root, []);
    assert.deepEqual(
      list.targets.map((target) => [target.written, target.path]),
      [
        ["$env:VX_FACTS_HOME\\cfg\\settings.json", path.join(root, "cfg", "settings.json")],
        ["${env:VX_FACTS_HOME}\\cfg", path.join(root, "cfg")],
        ["%vx_facts_home%\\cfg\\b.txt", path.join(root, "cfg", "b.txt")],
        ["$ENV:Vx_Facts_Home\\c.txt", path.join(root, "c.txt")],
      ],
    );
    assert.deepEqual(list.unresolved, ["$env:VX_FACTS_UNSET\\y", "%VX_FACTS_HOME%\\$name", "$env:VX_FACTS_LIST\\z"]);
    const lines = await target_facts(list, untouched, async () => "");
    assert.match(lines[0] ?? "", /^\$env:VX_FACTS_HOME\\cfg\\settings\.json: .*settings\.json, file, 2 bytes$/);
    assert.match(lines[1] ?? "", /^\$\{env:VX_FACTS_HOME\}\\cfg: .*cfg, directory, 1 entries \(settings\.json\)$/);
    assert.match(lines[2] ?? "", /b\.txt, does not exist$/);
    const literal = await command_targets("Remove-Item %VX_FACTS_HOME%\\d.txt", root, []);
    assert.deepEqual(literal.targets.map((target) => target.path), [path.join(root, "%VX_FACTS_HOME%", "d.txt")]);
  } finally {
    delete process.env.VX_FACTS_HOME;
    delete process.env.VX_FACTS_LIST;
  }
});

test("in a repository with a clean filter, the target reads never run it and report tracked, untracked, ignored and modified", { skip: !has_git }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-repo-"));
  roots.push(root);
  const marker = path.join(root, "filter-ran.txt").replaceAll("\\", "/");
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "test");
  git(root, "config", "gc.auto", "0");
  git(root, "config", "maintenance.auto", "false");
  git(root, "config", "filter.mark.clean", `sh -c 'echo ran >> "${marker}"; cat'`);
  await fs.writeFile(path.join(root, ".gitattributes"), "*.txt filter=mark\n");
  await fs.writeFile(path.join(root, ".gitignore"), "ignored.log\nfilter-ran.txt\n");
  await fs.writeFile(path.join(root, "tracked.txt"), "same\n");
  await fs.writeFile(path.join(root, "changed.txt"), "before\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  const runs = async () => (await fs.readFile(marker, "utf8").catch(() => "")).split("\n").filter(Boolean).length;
  assert.ok((await runs()) > 0);
  await fs.writeFile(path.join(root, "tracked.txt"), "same\n");
  await fs.writeFile(path.join(root, "changed.txt"), "after\n");
  await fs.writeFile(path.join(root, "new.md"), "new\n");
  await fs.writeFile(path.join(root, "ignored.log"), "x\n");
  const before = await runs();
  const lines = await target_facts(await command_targets("Remove-Item tracked.txt changed.txt new.md ignored.log", root, []), untouched, run_git);
  assert.equal(await runs(), before);
  assert.match(lines[0] ?? "", /^tracked\.txt: .*, git: tracked, (?:modified|unmodified)$/);
  assert.match(lines[1] ?? "", /^changed\.txt: .*, git: tracked, modified$/);
  assert.match(lines[2] ?? "", /^new\.md: .*, git: untracked$/);
  assert.match(lines[3] ?? "", /^ignored\.log: .*, git: not in the index$/);
});

test("a directory target counts its entries and names them when there are 20 or fewer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-dir-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "out"));
  for (const name of ["a.js", "b.js"]) await fs.writeFile(path.join(root, "out", name), "x");
  const lines = await target_facts(await command_targets("Remove-Item out", root, []), untouched, async () => "");
  assert.match(lines[0] ?? "", /^out: .*out, directory, 2 entries \(a\.js, b\.js\)$/);
});

test("target facts mark files and folders created or modified in this chat and files the agent wrote, and leave older untouched ones bare", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-marks-"));
  roots.push(root);
  const at = (name: string) => path.join(root, name);
  await fs.writeFile(at("old.txt"), "old");
  await fs.writeFile(at("kept.txt"), "kept");
  await fs.mkdir(at("olddir"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await fs.writeFile(at("new.txt"), "new");
  await fs.mkdir(at("newdir"));
  await fs.writeFile(at("agent.py"), "print(1)");
  const births = await Promise.all(["new.txt", "newdir", "agent.py"].map(async (name) => (await fs.stat(at(name))).birthtimeMs));
  const scope = { chat_id: "c-facts-marks", chat_started_at: Math.min(...births) };
  assert.ok((await fs.stat(at("old.txt"))).birthtimeMs < scope.chat_started_at);
  await fs.writeFile(at("old.txt"), "changed");
  record_write(scope.chat_id, at("agent.py"), { actor: "main", tool: "write_file", call_id: "c1", at: Date.parse("2026-10-25T14:03:11Z"), sha256: await file_sha256(at("agent.py")), prior_birthtime: null });
  try {
    const lines = await target_facts(await command_targets("Remove-Item old.txt, kept.txt, olddir, new.txt, newdir, agent.py", root, []), scope, async () => "");
    const time = String.raw`\d\d-\d\d \d\d:\d\d:\d\d`;
    assert.match(lines[0] ?? "", new RegExp(String.raw`^old\.txt: .*old\.txt, file, 7 bytes, modified since this chat started at ${time}$`));
    assert.match(lines[1] ?? "", /^kept\.txt: .*kept\.txt, file, 4 bytes$/);
    assert.match(lines[2] ?? "", /^olddir: .*olddir, directory, 0 entries$/);
    assert.match(lines[3] ?? "", new RegExp(String.raw`^new\.txt: .*new\.txt, file, 3 bytes, created in this chat at ${time}$`));
    assert.match(lines[4] ?? "", new RegExp(String.raw`^newdir: .*newdir, directory, 0 entries, created in this chat at ${time}$`));
    assert.match(lines[5] ?? "", /^agent\.py: .*agent\.py, file, 8 bytes, written by main via write_file at 10-25 14:03:11$/);
  } finally {
    forget_chat_writes(scope.chat_id);
  }
});

const script_file = (root: string, name: string, text: string) => ({
  id: name, path: name, abs: path.join(root, name), outside: false, role: "started" as const, sha256: null, bytes: text.length, chars: text.length, text, binary: false, over_limit: false, change: null,
});

test("option values, response files and redirections become targets while plain switches stay out", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-options-"));
  roots.push(root);
  const command = String.raw`cl.exe '@build.rsp' /nologo /EHsc /std:c++20 /Fe:build\diag.exe /Fo"$env:VX_OPT_OUT\stub.obj" /p:Configuration=Release -OutFile:out\x.bin src\a.cpp > log.txt`;
  const list = await command_targets(command, root, [], { VX_OPT_OUT: path.join(root, "obj") });
  assert.deepEqual(
    list.targets.map((target) => [target.written, target.path]),
    [
      ["@build.rsp", path.join(root, "build.rsp")],
      [String.raw`/Fe:build\diag.exe`, path.join(root, "build", "diag.exe")],
      [String.raw`/Fo"$env:VX_OPT_OUT\stub.obj"`, path.join(root, "obj", "stub.obj")],
      [String.raw`out\x.bin`, path.join(root, "out", "x.bin")],
      [String.raw`src\a.cpp`, path.join(root, "src", "a.cpp")],
      ["log.txt", path.join(root, "log.txt")],
    ],
  );
  assert.deepEqual(list.unresolved, []);
});

test("targets follow the walk: values, the location, splatting and expressions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-walk-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "sub"));
  const env = { VX_WALK_HOME: root };
  const list = await command_targets("$f = Join-Path $env:VX_WALK_HOME 'a.txt'; Remove-Item $f; Set-Location sub; Remove-Item b.txt; Copy-Item @args; 'c.txt' | Out-Null", root, [], env);
  assert.deepEqual(
    list.targets.map((target) => [target.written, target.where, target.path]),
    [
      ["$f", `command, = '${path.join(root, "a.txt")}'`, path.join(root, "a.txt")],
      ["sub", null, path.join(root, "sub")],
      ["b.txt", null, path.join(root, "sub", "b.txt")],
    ],
  );
  const lost = await command_targets("cd $where; Remove-Item b.txt", root, [], env);
  assert.deepEqual(lost.targets, []);
  assert.deepEqual(lost.unresolved, ["b.txt"]);
});

test("shell script bodies are walked in their own dialect with script lines", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-scripts-"));
  roots.push(root);
  const scripts = [
    script_file(root, "clean.bat", "set OUT=%VX_BAT_HOME%\\out\r\ndel %OUT%\\a.obj\r\nrd /s /q build"),
    script_file(root, "sync.ps1", "$dest = 'dist'\nRemove-Item -Recurse $dest\\old"),
  ];
  const list = await command_targets(".\\clean.bat; .\\sync.ps1", root, scripts, { VX_BAT_HOME: root });
  assert.deepEqual(
    list.targets.map((target) => [target.written, target.where, target.path]),
    [
      ["%OUT%\\a.obj", "clean.bat line 2", path.join(root, "out", "a.obj")],
      ["$dest\\old", "sync.ps1 line 2", path.join(root, "dist", "old")],
    ],
  );
});

test("program facts and notes come first as started and note lines", () => {
  const root = String.raw`D:\p`;
  const at = Date.parse("2026-10-11T08:00:05Z");
  const lines = program_lines(
    [
      { written: "$msbuild", how: "", path: String.raw`C:\VS\MSBuild.exe`, kind: "native", bytes: 387856, outside: true, change: null, origin: "", line: 1 },
      { written: String.raw`.\Release\example.exe`, how: "", path: String.raw`D:\p\Release\example.exe`, kind: "native", bytes: 1350000, outside: false, change: { kind: "modified", at }, origin: "", line: 3 },
      { written: "git", how: "PATH", path: String.raw`C:\Git\cmd\git.exe`, kind: "native", bytes: 100, outside: true, change: null, origin: path.join(root, "tools", "run.ps1"), line: 2 },
      { written: "$op", how: "", path: "Remove-Item", kind: "command", bytes: null, outside: false, change: null, origin: "", line: 1 },
      { written: "probe.exe", how: "", path: "probe.exe", kind: "not_found", bytes: null, outside: false, change: null, origin: "", line: 1 },
      { written: "$exe", how: String.raw`Start-Process, working directory D:\VantheaX`, path: String.raw`C:\Tools\probe.exe`, kind: "missing", bytes: null, outside: true, change: null, origin: "", line: 1 },
    ],
    ["working directory unknown after: cd $x"],
    [{ ...script_file(root, "tools/run.ps1", "git status"), abs: path.join(root, "tools", "run.ps1") }],
  );
  assert.deepEqual(lines, [
    String.raw`started $msbuild: C:\VS\MSBuild.exe, native executable, 387856 bytes, outside the project`,
    String.raw`started .\Release\example.exe: D:\p\Release\example.exe, native executable, 1350000 bytes, modified since this chat started at 10-11 08:00:05`,
    String.raw`started git (PATH, tools/run.ps1 line 2): C:\Git\cmd\git.exe, native executable, 100 bytes, outside the project`,
    "started $op: Remove-Item, no file of that name on PATH",
    "started probe.exe: probe.exe, not found on PATH",
    String.raw`started $exe (Start-Process, working directory D:\VantheaX): C:\Tools\probe.exe, does not exist, outside the project`,
    "note: working directory unknown after: cd $x",
  ]);
});

test("static .NET calls, forward-slash rooted paths and non-path interpreter values", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-facts-static-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "build"));
  const drive = path.parse(root).root;
  const targets = async (command: string) => (await command_targets(command, root, [])).targets.map((target) => [target.written, target.path]);
  assert.deepEqual(await targets("[IO.Directory]::Delete('sub\\out', $true)"), [["sub\\out", path.join(root, "sub", "out")]]);
  assert.deepEqual(await targets("Remove-Item -Recurse -Force /"), [["/", drive]]);
  assert.deepEqual(await targets("Remove-Item -Recurse -Force /Users/x/keep"), [["/Users/x/keep", path.join(drive, "Users", "x", "keep")]]);
  assert.deepEqual(await targets("python -m pkg.cli"), []);
  assert.deepEqual(await targets("Get-ChildItem build -Filter *.exe"), [["build", path.join(root, "build")]]);
  assert.deepEqual(await targets("node -e \"require('./x.js')\""), []);
  assert.deepEqual(await targets("xcopy src dst /s/e/y"), []);
});
