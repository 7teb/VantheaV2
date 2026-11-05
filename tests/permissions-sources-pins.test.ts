import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { changed_pins } from "../electron/permissions/source-read.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { send_candidate } from "../electron/permissions/source-files.ts";
import { forget_chat_writes, record_write } from "../electron/permissions/written-files.ts";
import { fixture, sent_text } from "./sources-fixture.ts";

test("a 70,000-character script is read whole and pinned on its raw bytes", async () => {
  const root = await fixture({ "large.py": "x".repeat(70000) });
  const large = await inspect_command_sources(root, root, "python large.py");
  assert.equal(large.complete, true);
  assert.equal(large.files.length, 1);
  assert.equal(large.files[0]?.text?.length, 70000);
  assert.equal(large.files[0]?.sha256, createHash("sha256").update(Buffer.from("x".repeat(70000))).digest("hex"));
  assert.deepEqual(large.pins, [{ path: large.files[0]?.abs, sha256: large.files[0]?.sha256 }]);
});

test("a file over the read limit is hashed in full and never decoded", async () => {
  const bytes = Buffer.alloc(1048577, 0x61);
  const root = await fixture({});
  await fs.writeFile(path.join(root, "huge.py"), bytes);
  const sources = await inspect_command_sources(root, root, "python huge.py");
  assert.equal(sources.files[0]?.text, null);
  assert.equal(sources.files[0]?.over_limit, true);
  assert.equal(sources.files[0]?.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.match(sources.gaps.join("\n"), /exceeds the read limit \(1,048,576 bytes\): .*huge\.py/);
});

test("the pin digest ignores the environment and gap text", async () => {
  const root = await fixture({ "a.py": "print(1)" });
  const before = await inspect_command_sources(root, root, "python a.py; python $other");
  process.env.VX_SOURCES_TEST = String(Date.now());
  const after = await inspect_command_sources(root, root, "python a.py; python $another");
  delete process.env.VX_SOURCES_TEST;
  assert.equal(before.hash, after.hash);
});

test("a missing child is pinned absent and the recheck sees every pin change", async () => {
  const root = await fixture({ "parent.ps1": "& .\\child.ps1" });
  const missing = await inspect_command_sources(root, root, ".\\parent.ps1");
  const child = missing.pins.find((pin) => pin.path.endsWith("child.ps1"));
  assert.equal(child?.sha256, null);
  assert.deepEqual(await changed_pins(missing.pins), []);
  await fs.writeFile(path.join(root, "child.ps1"), "Write-Output now");
  const changes = await changed_pins(missing.pins);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.before, null);
  assert.ok(changes[0]?.after);
  const present = await inspect_command_sources(root, root, ".\\parent.ps1");
  assert.notEqual(present.hash, missing.hash);
  await fs.rm(path.join(root, "parent.ps1"));
  assert.deepEqual((await changed_pins(present.pins)).map((change) => change.after), [null]);
});

test("named and loaded files follow the change mark", async () => {
  const root = await fixture({
    "main.mjs": "import { helper } from './lib/helper.mjs';\nimport fs from 'node:fs';\nconsole.log(helper);",
    "lib/helper.mjs": "export const helper = 'loaded-marker';",
    "run.py": "import tools.local\nprint(tools.local.x)",
    "tools/local.py": "x = 'py-loaded-marker'",
    "dyn.mjs": "const name = process.argv[2];\nawait import(name);",
  });
  const before = Date.now() + 60000;
  const unchanged = await inspect_command_sources(root, root, "node main.mjs; python run.py", { chat_id: "c-marks", chat_started_at: before });
  const helper = unchanged.files.find((file) => file.path === "lib/helper.mjs");
  assert.equal(helper?.role, "loaded");
  assert.equal(helper?.change, null);
  assert.equal(send_candidate(helper!), false);
  assert.ok(unchanged.pins.some((pin) => pin.path === helper?.abs));
  assert.equal(unchanged.files.find((file) => file.path === "tools/local.py")?.role, "loaded");
  assert.deepEqual(unchanged.gaps, []);
  const modified = await inspect_command_sources(root, root, "node main.mjs; python run.py", { chat_id: "c-marks", chat_started_at: 0 });
  assert.match(sent_text(modified), /loaded-marker/);
  assert.match(sent_text(modified), /py-loaded-marker/);
  record_write("c-written", path.join(root, "lib", "helper.mjs"), { actor: "main", tool: "write_file", call_id: "c1", at: 5, sha256: helper?.sha256 ?? "", prior_birthtime: null });
  const written = await inspect_command_sources(root, root, "node main.mjs", { chat_id: "c-written", chat_started_at: before });
  assert.deepEqual(written.files.find((file) => file.path === "lib/helper.mjs")?.change, { kind: "written", actor: "main", tool: "write_file", at: 5, same_bytes: true, before_chat: false });
  forget_chat_writes("c-written");
  const dynamic = await inspect_command_sources(root, root, "node dyn.mjs");
  assert.match(dynamic.gaps.join("\n"), /Import could not be resolved: import\(name\) in .*dyn\.mjs/);
});

test("directory entries list unchanged files and send changed ones", async () => {
  const root = await fixture({ "tests/a.test.mjs": "a", "tests/b.test.mjs": "b", "tests/c.test.mjs": "c" });
  const since = Date.now() + 60000;
  const later = new Date(since + 60000);
  await fs.utimes(path.join(root, "tests", "c.test.mjs"), later, later);
  const sources = await inspect_command_sources(root, root, "node --test tests", { chat_id: "c-dir", chat_started_at: since });
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files.map((file) => [file.path, file.role, send_candidate(file)]), [
    ["tests/a.test.mjs", "loaded", false],
    ["tests/b.test.mjs", "loaded", false],
    ["tests/c.test.mjs", "loaded", true],
  ]);
  const glob = await inspect_command_sources(root, root, "node --test \"tests/**/*.test.mjs\"");
  assert.equal(glob.files.length, 3);
});

test("encoded payloads are sent decoded", async () => {
  const root = await fixture({});
  const encoded = Buffer.from("Write-Output payload-marker", "utf16le").toString("base64");
  const sources = await inspect_command_sources(root, root, `powershell -EncodedCommand ${encoded}`);
  const payload = sources.files.find((file) => file.role === "payload");
  assert.equal(payload?.text, "Write-Output payload-marker");
  assert.equal(sources.pins.length, 0);
});

test("npm scripts send the selected entries and pin the whole manifest", async () => {
  const manifest = JSON.stringify({ scripts: { prebuild: "echo pre", build: "echo build", postbuild: "echo post", deploy: "echo secret-deploy" } });
  const root = await fixture({ "package.json": manifest });
  const sources = await inspect_command_sources(root, root, "npm run build");
  const entry = sources.files.find((file) => file.role === "manifest");
  assert.deepEqual(JSON.parse(entry?.text ?? "{}"), { prebuild: "echo pre", build: "echo build", postbuild: "echo post" });
  assert.equal(entry?.sha256, createHash("sha256").update(manifest).digest("hex"));
});

test("a project binary is a program fact and pinned without a gap", async () => {
  const root = await fixture({});
  const bytes = Buffer.from([0x4d, 0x5a, 0, 0, 1, 2]);
  await fs.mkdir(path.join(root, "bin"));
  await fs.writeFile(path.join(root, "bin", "tool.exe"), bytes);
  const sources = await inspect_command_sources(root, root, ".\\bin\\tool.exe --scan");
  const tool = path.join(await fs.realpath(root), "bin", "tool.exe");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files, []);
  assert.deepEqual(sources.programs.map((fact) => [fact.path.toLowerCase(), fact.kind, fact.bytes, fact.outside]), [[tool.toLowerCase(), "native", 6, false]]);
  assert.deepEqual(sources.pins.map((pin) => [pin.path.toLowerCase(), pin.sha256]), [[tool.toLowerCase(), createHash("sha256").update(bytes).digest("hex")]]);
});

test("changed child contents invalidate the source hash and repeated entry references are deduplicated", async () => {
  const root = await fixture({ "entry.sh": "python child.py", "child.py": "print('first')" });
  const before = await inspect_command_sources(root, root, "bash entry.sh; bash entry.sh");
  assert.equal(before.complete, true);
  assert.equal((sent_text(before).match(/print\('first'\)/g) ?? []).length, 1);
  await fs.writeFile(path.join(root, "child.py"), "print('second')");
  const after = await inspect_command_sources(root, root, "bash entry.sh; bash entry.sh");
  assert.notEqual(before.hash, after.hash);
});

test("a 130,000-character script is read and its hash changes when it is edited", async () => {
  const root = await fixture({ "large.py": "a".repeat(130000) });
  const before = await inspect_command_sources(root, root, "python large.py");
  await fs.writeFile(path.join(root, "large.py"), "b".repeat(130000));
  const after = await inspect_command_sources(root, root, "python large.py");
  assert.equal(before.files[0]?.text?.length, 130000);
  assert.deepEqual(before.gaps, []);
  assert.notEqual(before.hash, after.hash);
});
