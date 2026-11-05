import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fixture, sent_text } from "./sources-fixture.ts";

test("literal bat and cmd invocations are read as text through the shared script detector", async () => {
  const root = await fixture({ "poc/build.bat": "call child.cmd\ncl /c poc.cpp", "child.cmd": "echo child-marker" });
  const sources = await inspect_command_sources(root, root, "cmd /c poc\\build.bat");
  assert.equal(sources.complete, true);
  assert.match(sent_text(sources), /cl \/c poc\.cpp/);
  assert.match(sent_text(sources), /child-marker/);
  assert.deepEqual(sources.gaps, []);
});

test("quoted literal source paths with spaces and all existing hosts retain complete source", async () => {
  const root = await fixture({ "with space/scan.py": "print('python-marker')", "scan.ps1": "Write-Output powershell-marker", "scan.sh": "echo shell-marker" });
  const sources = await inspect_command_sources(root, root, 'python "with space/scan.py"; pwsh -NoProfile -ExecutionPolicy Bypass -File "scan.ps1"; bash scan.sh');
  assert.equal(sources.complete, true);
  assert.match(sent_text(sources), /python-marker/);
  assert.match(sent_text(sources), /powershell-marker/);
  assert.match(sent_text(sources), /shell-marker/);
});

test("a positional script cannot be replaced by a later inline or file option argument", async () => {
  const root = await fixture({ "real.py": "print('real-entry')", "decoy.py": "print('decoy')" });
  const sources = await inspect_command_sources(root, root, "python real.py -c noop -file decoy.py");
  assert.equal(sources.complete, true);
  assert.match(sent_text(sources), /real-entry/);
  assert.doesNotMatch(sent_text(sources), /print\('decoy'\)/);
});

test("generic textual child invocation inside a source body is inspected recursively", async () => {
  const root = await fixture({ "parent.py": 'import subprocess\nsubprocess.run(["node", "child.mjs"])', "child.mjs": 'console.log("nested-marker")' });
  const sources = await inspect_command_sources(root, root, "python parent.py");
  assert.equal(sources.complete, true);
  assert.match(sent_text(sources), /nested-marker/);
});

test("a missing child source is a concrete gap and participates in the fingerprint", async () => {
  const root = await fixture({ "parent.ps1": "& missing.ps1" });
  const missing = await inspect_command_sources(root, root, ".\\parent.ps1");
  assert.equal(missing.complete, false);
  assert.match(missing.gaps?.join("\n") ?? "", /Source is unavailable:.*missing\.ps1/);
  await fs.writeFile(path.join(root, "missing.ps1"), "Write-Output restored");
  const restored = await inspect_command_sources(root, root, ".\\parent.ps1");
  assert.equal(restored.complete, true);
  assert.notEqual(missing.hash, restored.hash);
});

test("dynamic paths and dynamic process arguments cannot be claimed complete", async () => {
  const root = await fixture({ "parent.py": "import subprocess\nsubprocess.run(command)" });
  for (const command of ["python $script", "cmd /c call %SCRIPT%", "cmd /c $payload", "powershell -Command $code", "python parent.py"]) {
    const sources = await inspect_command_sources(root, root, command, { chat_id: "", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH: "" } });
    assert.equal(sources.complete, false, command);
    assert.ok(sources.gaps?.some(gap => /could not be resolved|Dynamic process/.test(gap)), command);
  }
});

test("installed entry modules and preloads are facts, a missing relative preload is a pinned fact", async () => {
  const root = await fs.realpath(await fixture({ "main.js": "console.log(1)" }));
  const scope = { chat_id: "", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH: "" } };
  for (const [command, spec, how] of [["python -m opaque_module", "opaque_module", "python -m"], ["node --require helper.js main.js", "helper.js", "node preload"]]) {
    const sources = await inspect_command_sources(root, root, command, scope);
    assert.deepEqual(sources.gaps, [], command);
    assert.deepEqual(sources.programs.map((fact) => [fact.written, fact.how, fact.path, fact.kind]), [[spec, how, spec, "installed"]], command);
  }
  const missing = await inspect_command_sources(root, root, "node --require ./helper.js main.js", scope);
  assert.deepEqual(missing.gaps, []);
  assert.deepEqual(missing.programs.map((fact) => [fact.path, fact.kind]), [[path.join(root, "helper.js"), "missing"]]);
  assert.ok(missing.pins.some((pin) => pin.path === path.join(root, "helper.js") && pin.sha256 === null));
  await fs.writeFile(path.join(root, "helper.js"), "console.log('preload-marker')");
  const present = await inspect_command_sources(root, root, "node --require ./helper.js main.js", scope);
  assert.deepEqual(present.files.map((file) => [file.path, file.role]), [["main.js", "started"], ["helper.js", "loaded"]]);
  assert.notEqual(missing.hash, present.hash);
  const empty = await inspect_command_sources(root, root, "python -m", scope);
  assert.match(empty.gaps.join("\n"), /module or preload dependency could not be inspected: python/);
});

test("literal directory changes use the actual execution cwd for source paths", async () => {
  const root = await fixture({ "sub/scan.py": "print('correct-location')", "scan.py": "print('wrong-location')" });
  const sources = await inspect_command_sources(root, root, "cd sub; python scan.py");
  assert.equal(sources.complete, true);
  assert.match(sent_text(sources), /correct-location/);
  assert.doesNotMatch(sent_text(sources), /wrong-location/);
  const dynamic = await inspect_command_sources(root, root, "cd $target; python scan.py");
  assert.equal(dynamic.complete, false);
  assert.deepEqual(dynamic.gaps, ["Launch target could not be resolved: scan.py (working directory unknown after: cd $target)"]);
  assert.doesNotMatch(sent_text(dynamic), /wrong-location/);
});

test("child source paths stay relative to the invocation cwd instead of the containing script folder", async () => {
  const root = await fixture({ "sub/entry.sh": "python child.py", "child.py": "print('cwd-child')", "sub/child.py": "print('file-folder-child')" });
  const sources = await inspect_command_sources(root, root, "bash sub/entry.sh");
  assert.equal(sources.complete, true);
  assert.match(sent_text(sources), /cwd-child/);
  assert.doesNotMatch(sent_text(sources), /file-folder-child/);
});

test("an absent outside toolchain script started by its path is unavailable, not trusted", async () => {
  const root = await fixture({});
  const outside = path.join(path.dirname(root), "Microsoft Visual Studio", "vcvars64.bat");
  const sources = await inspect_command_sources(root, root, 'cmd /c call "' + outside + '"');
  assert.equal(sources.complete, false);
  assert.match(sources.gaps?.join("\n") ?? "", /Source is unavailable:.*vcvars64\.bat \(ENOENT\)/);
});

test("script depth stops at four inspected files and never hides the required fifth file", async () => {
  const root = await fixture({
    "one.sh": "bash two.sh", "two.sh": "bash three.sh", "three.sh": "bash four.sh",
    "four.sh": "bash five.sh", "five.sh": "echo hidden-marker",
  });
  const sources = await inspect_command_sources(root, root, "bash one.sh");
  assert.equal(sources.complete, false);
  assert.match(sources.gaps?.join("\n") ?? "", /depth exceeded.*five\.sh/);
  assert.doesNotMatch(sent_text(sources), /hidden-marker/);
});

test("the source file count limit returns an explicit gap", async () => {
  const files: Record<string, string> = {};
  for (let index = 0; index < 33; index += 1) files[index + ".py"] = "print(" + index + ")";
  const root = await fixture(files);
  const command = Object.keys(files).map(file => "python " + file).join(";");
  const sources = await inspect_command_sources(root, root, command);
  assert.equal(sources.complete, false);
  assert.match(sources.gaps?.join("\n") ?? "", /file limit exceeded.*32\.py/);
});

test("instruction files are not sources", async () => {
  const root = await fixture({ "AGENTS.md": "rules", "CLAUDE.md": "more rules", "a.py": "print(1)" });
  const sources = await inspect_command_sources(root, root, "python a.py");
  assert.deepEqual(sources.files.map((file) => file.path), ["a.py"]);
});

test("package runners, tsx and Import-Module start their script", async () => {
  const root = await fixture({ "scripts/x.ts": "console.log('ts-marker')", "scripts/x.py": "print('py-marker')", "scripts/x.ps1": "Write-Output ps-marker" });
  for (const [command, marker] of [
    ["npx tsx scripts/x.ts", "ts-marker"],
    ["tsx scripts/x.ts", "ts-marker"],
    ["uv run scripts/x.py", "py-marker"],
    ["Import-Module .\\scripts\\x.ps1", "ps-marker"],
  ]) {
    const sources = await inspect_command_sources(root, root, command);
    assert.deepEqual(sources.gaps, [], command);
    const started = sources.files.find((file) => file.role === "started");
    assert.match(started?.text ?? "", new RegExp(marker), command);
  }
});

test("-m and --require resolve locally first", async () => {
  const root = await fixture({ "tool/__main__.py": "print('module-main')", "pre.js": "console.log('pre')", "main.js": "console.log(1)" });
  const local = await inspect_command_sources(root, root, "python -m tool");
  assert.equal(local.files[0]?.role, "loaded");
  assert.deepEqual(local.gaps, []);
  const preload = await inspect_command_sources(root, root, "node --require ./pre.js main.js");
  assert.deepEqual(preload.gaps, []);
  assert.deepEqual(preload.files.map((file) => [file.path, file.role]).sort(), [["main.js", "started"], ["pre.js", "loaded"]]);
});

test("package script text follows the same generic source detector and missing entries are gaps", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({ scripts: { build: "node build.js", test: "python check.py" } }),
    "build.js": "console.log('build-marker')", "check.py": "print('test-marker')",
  });
  const sources = await inspect_command_sources(root, root, "npm run build; npm test; npm run build");
  assert.equal(sources.complete, true);
  assert.match(sent_text(sources), /build-marker/);
  assert.match(sent_text(sources), /test-marker/);
  const missing = await inspect_command_sources(root, root, "npm run missing");
  assert.equal(missing.complete, false);
  assert.match(missing.gaps?.join("\n") ?? "", /Package script is missing: missing/);
});

test("protected source contents stay out of the review request", async () => {
  const root = await fixture({ ".ssh/secret.py": "print('must-not-leak')" });
  const sources = await inspect_command_sources(root, root, "python .ssh/secret.py");
  assert.equal(sources.complete, false);
  assert.doesNotMatch(sent_text(sources), /must-not-leak/);
});

test("the real repository npm build inspects selected scripts without inventing a project npm shim or node config invocation", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sources = await inspect_command_sources(root, root, "npm.cmd run build");
  assert.equal(sources.complete, true, sources.gaps?.join("\n"));
  assert.match(sent_text(sources), /scripts[\\/]build-main\.mjs/);
  assert.match(sent_text(sources), /platform: "node"/);
  assert.deepEqual(sources.gaps, []);
});

test("quoted interpreter names in configuration, documentation and ordinary string data are not invocations", async () => {
  const root = await fixture({
    "settings.mjs": 'const options = {platform: "node", target: "node22"};\nconst docs = \'exec("node absent.js")\';\nconst note = "python absent.py";\nconst label = "node";\nconst matcher = /node/.exec("python absent.py");\n/* Documentation\nexec("node absent.js")\n*/',
    "documentation.py": '"""Usage: node absent.js\nexec("python absent.py")\n"""\nlabel = "node"\nprint(label)',
    "echo.sh": 'echo "node absent.js"\necho "python absent.py"',
  });
  const sources = await inspect_command_sources(root, root, "node settings.mjs; python documentation.py; bash echo.sh");
  assert.equal(sources.complete, true, sources.gaps?.join("\n"));
  assert.deepEqual(sources.gaps, []);
});

test("known literal subprocess, exec and spawn calls retain source inspection rather than becoming arbitrary string matches", async () => {
  const root = await fixture({
    "parent.mjs": 'exec("node child.js");\nspawn("python", ["child.py"]);\nchild_process.execFile("node", ["other.mjs"]);',
    "child.js": 'console.log("literal-exec")', "child.py": 'print("literal-spawn")', "other.mjs": 'console.log("literal-execfile")',
  });
  const sources = await inspect_command_sources(root, root, "node parent.mjs");
  assert.equal(sources.complete, true, sources.gaps?.join("\n"));
  assert.match(sent_text(sources), /literal-exec/);
  assert.match(sent_text(sources), /literal-spawn/);
  assert.match(sent_text(sources), /literal-execfile/);
});

test("bare package-manager cmd shims use package scripts while an explicit project shim is inspected", async () => {
  const root = await fixture({ "package.json": JSON.stringify({ scripts: { build: "node build.js" } }), "build.js": "console.log('manifest-source')", "npm.cmd": "call local.cmd", "local.cmd": "echo explicit-shim-source" });
  const installed = await inspect_command_sources(root, root, "npm.cmd run build");
  assert.equal(installed.complete, true);
  assert.match(sent_text(installed), /manifest-source/);
  assert.doesNotMatch(sent_text(installed), /explicit-shim-source/);
  const local = await inspect_command_sources(root, root, ".\\npm.cmd run build");
  assert.equal(local.complete, true);
  assert.match(sent_text(local), /explicit-shim-source/);
});

test("selected package pre and post lifecycle scripts are inspected and unresolved lifecycle sources are gaps", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({ scripts: { prebuild: "python before.py", build: "node build.js", postbuild: "bash after.sh" } }),
    "before.py": "print('prebuild-source')", "build.js": "console.log('build-source')", "after.sh": "echo postbuild-source",
  });
  const sources = await inspect_command_sources(root, root, "npm run build");
  assert.equal(sources.complete, true, sources.gaps?.join("\n"));
  assert.match(sent_text(sources), /prebuild-source/);
  assert.match(sent_text(sources), /build-source/);
  assert.match(sent_text(sources), /postbuild-source/);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "node build.js", postbuild: "python absent.py" } }));
  const missing = await inspect_command_sources(root, root, "npm run build");
  assert.equal(missing.complete, false);
  assert.match(missing.gaps?.join("\n") ?? "", /Source is unavailable:.*absent\.py/);
  assert.equal((await inspect_command_sources(root, root, "npm run build --ignore-scripts")).complete, true);
});

test("literal child scripts inside Python and Node inline cmd wrappers cannot be approved as complete when missing", async () => {
  const root = await fixture({});
  const commands = [
    'python -c "import subprocess; subprocess.run([\'cmd\', \'/c\', \'missing-child.bat\'])"',
    'node -e "require(\'child_process\').execFileSync(\'cmd\', [\'/c\', \'missing-child.cmd\'])"',
  ];
  for (const command of commands) {
    const sources = await inspect_command_sources(root, root, command);
    assert.equal(sources.complete, false, command);
    assert.match(sources.gaps?.join("\n") ?? "", /Source is unavailable:.*missing-child\.(?:bat|cmd)/);
  }
});

test("an inline process launcher cannot hide a required fifth script beyond the source depth limit", async () => {
  const root = await fixture({
    "one.bat": "call two.cmd", "two.cmd": "call three.sh", "three.sh": "bash four.sh",
    "four.sh": "python five.py", "five.py": "print('fifth-source')",
  });
  const command = 'python -c "import subprocess; subprocess.run([\'cmd\', \'/c\', \'one.bat\'])"';
  const sources = await inspect_command_sources(root, root, command);
  assert.equal(sources.complete, false);
  assert.match(sources.gaps?.join("\n") ?? "", /depth exceeded.*five\.py/);
  assert.doesNotMatch(sent_text(sources), /fifth-source/);
});

test("literal inline launchers inspect existing child source while harmless inline code retains complete input", async () => {
  const root = await fixture({ "child.cmd": "echo inline-child-source" });
  const command = 'node -e "require(\'child_process\').execFileSync(\'cmd\', [\'/c\', \'child.cmd\'])"';
  const sources = await inspect_command_sources(root, root, command);
  assert.equal(sources.complete, true, sources.gaps?.join("\n"));
  assert.match(sent_text(sources), /inline-child-source/);
  assert.equal((await inspect_command_sources(root, root, 'python -c "print(\'literal node missing.py\')"')).complete, true);
});

test("dynamic process argv and inline payload expressions stay uninspectable instead of acquiring synthetic quotes", async () => {
  const root = await fixture({});
  const commands = [
    'python -c "import subprocess; subprocess.run([\'cmd\', \'/c\', child_path])"',
    'python -c "import subprocess; subprocess.run([\'python\', \'-c\', code])"',
    'node -e "require(\'child_process\').execFileSync(\'cmd\', [\'/c\', childPath])"',
    'node -e "const { exec } = require(\'child_process\'); exec(\'python \' + childPath)"',
  ];
  for (const command of commands) {
    const sources = await inspect_command_sources(root, root, command);
    assert.equal(sources.complete, false, command);
    assert.match(sources.gaps.join("\n"), /Dynamic process invocation/);
  }
  const local = await inspect_command_sources(root, root, 'node -e "function exec(text) { return text.length } exec(input)"');
  assert.equal(local.complete, true);
});

test("a quoted absolute cmd host in a literal process argv retains child inspection", async () => {
  const root = await fixture({});
  const command = 'node -e "require(\'child_process\').execFileSync(\'C:/Program Files/Host/cmd.exe\', [\'/c\', \'missing-child.cmd\'])"';
  const sources = await inspect_command_sources(root, root, command);
  assert.equal(sources.complete, false);
  assert.match(sources.gaps?.join("\n") ?? "", /Source is unavailable:.*missing-child\.cmd/);
});
