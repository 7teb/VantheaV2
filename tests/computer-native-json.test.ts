import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { before, test } from "node:test";
import { native_source } from "../electron/computer/native.ts";
import { input_source } from "../electron/computer/native-input.ts";
import { loop_source } from "../electron/computer/native-loop.ts";

const cases = [
  { name: "plain click", field: "modifiers", codes: [] },
  { name: "Shift click", field: "modifiers", codes: [16] },
  { name: "Control Shift click", field: "modifiers", codes: [17, 16] },
  { name: "all click modifiers", field: "modifiers", codes: [17, 16, 18, 91] },
  { name: "Enter", field: "keys", codes: [13] },
  { name: "Control A", field: "keys", codes: [17, 65] },
  { name: "Control Shift S", field: "keys", codes: [17, 16, 83] },
];

const probe_source = String.raw`
public static partial class VantheaXComputer
{
    public static string ProbeJson(string text, string field)
    {
        var request = Serializer().Deserialize<Dictionary<string, object>>(text);
        var collection = request[field].GetType().FullName;
        try { return Serializer().Serialize(new { collection = collection, keys = Keys(request, field) }); }
        catch (Exception error) { return Serializer().Serialize(new { collection = collection, error = error.Message }); }
    }
}
`;

let replies: { collection: string; keys?: number[]; error?: string }[] = [];

before(() => {
  if (process.platform !== "win32") return;
  const calls = cases.map((entry) => {
    const request = JSON.stringify({ op: entry.field === "keys" ? "key" : "click", [entry.field]: entry.codes });
    return `[Console]::WriteLine([VantheaXComputer]::ProbeJson('${request}', '${entry.field}'))`;
  }).join("\n");
  const script = `$ErrorActionPreference='Stop'\nAdd-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms,System.Web.Extensions -TypeDefinition @'\n${native_source}${input_source}${loop_source}${probe_source}\n'@\n${calls}`;
  const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine())))"], { windowsHide: true, input: Buffer.from(script).toString("base64") + "\n", encoding: "utf8", timeout: 30000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  replies = child.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(replies.length, cases.length);
});

for (const [index, entry] of cases.entries()) {
  test(`native JSON parser accepts ${entry.name} without sending desktop input`, { skip: process.platform !== "win32" }, () => {
    assert.equal(replies[index].collection, "System.Collections.ArrayList");
    assert.equal(replies[index].error, undefined);
    assert.deepEqual(replies[index].keys, entry.codes);
  });
}
