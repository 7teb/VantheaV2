import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { inspect_command_sources, type CommandSources } from "../electron/permissions/sources.ts";
import { send_candidate } from "../electron/permissions/source-files.ts";
import { encode_text } from "../electron/storage/text-codec.ts";

const roots: string[] = [];

const sent_text = (sources: CommandSources): string =>
  sources.files.filter(send_candidate).map((file) => `${file.path || "payload"}\n${file.text}`).join("\n\n");

const fixture = async (files: Record<string, string | Buffer>): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-sources-runtime-"));
  roots.push(root);
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }
  return root;
};

after(async () => {
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

const windows_dir = ["C:", "Windows"].join("\\");

test("UTF-16 scripts are decoded so their real content reaches the review", async () => {
  const root = await fixture({
    "le.ps1": encode_text("Write-Output le-marker", { charset: "utf16le", bom: true }),
    "be.ps1": encode_text("Write-Output be-marker", { charset: "utf16be", bom: true }),
    "plain.ps1": encode_text("Write-Output plain-marker", { charset: "utf16le", bom: false }),
  });
  const sources = await inspect_command_sources(root, root, "& .\\le.ps1; & .\\be.ps1; & .\\plain.ps1");
  assert.match(sent_text(sources), /le-marker/);
  assert.match(sent_text(sources), /be-marker/);
  assert.match(sent_text(sources), /plain-marker/);
  assert.doesNotMatch(sent_text(sources), /\u0000/);
});

test("code read from a file and executed with iex, Invoke-Expression, scriptblocks or eval is inspected", async () => {
  const root = await fixture({ "x.ps1": "Write-Output iex-marker", "x.sh": "echo eval-marker" });
  const commands = [
    "iex (Get-Content .\\x.ps1 -Raw)",
    "Invoke-Expression (gc x.ps1 | Out-String)",
    "Get-Content x.ps1 -Raw | iex",
    "& ([scriptblock]::Create((Get-Content x.ps1 -Raw)))",
  ];
  for (const command of commands) {
    const sources = await inspect_command_sources(root, root, command);
    assert.match(sent_text(sources), /iex-marker/, command);
  }
  const eval_sources = await inspect_command_sources(root, root, "bash -c 'eval \"$(cat x.sh)\"'");
  assert.match(sent_text(eval_sources), /eval-marker/);
});

test("code built or downloaded at runtime and executed is reported as a gap", async () => {
  const root = await fixture({});
  const sources = await inspect_command_sources(root, root, "iex (irm https://example.invalid/install.ps1)");
  assert.equal(sources.complete, false);
  assert.match(sources.gaps.join("\n"), /built or downloaded at runtime/);
});

test("an iex-executed file is fingerprinted, so swapping its content changes the hash", async () => {
  const root = await fixture({ "x.ps1": "Write-Output one" });
  const first = await inspect_command_sources(root, root, "iex (Get-Content .\\x.ps1 -Raw)");
  await fs.writeFile(path.join(root, "x.ps1"), "Write-Output two");
  const second = await inspect_command_sources(root, root, "iex (Get-Content .\\x.ps1 -Raw)");
  assert.notEqual(first.hash, second.hash);
});

test("scripts started through Start-Process, saps and nested -File arguments are inspected", async () => {
  const root = await fixture({ "payload.ps1": "Write-Output start-marker", "tool.bat": "echo bat-marker" });
  const commands = [
    "Start-Process -FilePath .\\payload.ps1",
    "saps .\\payload.ps1",
    "Start-Process powershell -ArgumentList '-File','.\\payload.ps1' -Wait",
    "powershell -c \"Start-Process -FilePath .\\payload.ps1\"",
  ];
  for (const command of commands) {
    const sources = await inspect_command_sources(root, root, command);
    assert.match(sent_text(sources), /start-marker/, command);
  }
  const bat = await inspect_command_sources(root, root, "Start-Process .\\tool.bat -NoNewWindow");
  assert.match(sent_text(bat), /bat-marker/);
});

test("a destructive system operation inside a launched script is reported", async () => {
  const root = await fixture({
    "clean.ps1": `Remove-Item ${windows_dir}\\Temp -Recurse -Force`,
    "outer.bat": "call clean.cmd",
    "clean.cmd": "format d: /q",
    "fine.ps1": "Remove-Item .\\build -Recurse -Force",
  });
  assert.match((await inspect_command_sources(root, root, ".\\clean.ps1")).catastrophic.join("\n"), /clean\.ps1/);
  assert.match((await inspect_command_sources(root, root, "cmd /c outer.bat")).catastrophic.join("\n"), /clean\.cmd: formatting a drive/);
  assert.deepEqual((await inspect_command_sources(root, root, ".\\fine.ps1")).catastrophic, []);
});

test("ordinary build scripts with local exec helpers or template commands do not hide anything", async () => {
  const root = await fixture({
    "build.mjs": "function exec(cmd) { return cmd.trim() }\nexec(process.argv[2])\nconsole.log('built')\n",
    "package.json": JSON.stringify({ scripts: { build: "node build.mjs" } }),
  });
  const sources = await inspect_command_sources(root, root, "npm run build");
  assert.equal(sources.complete, true);
  assert.match(sent_text(sources), /console\.log\('built'\)/);
});
