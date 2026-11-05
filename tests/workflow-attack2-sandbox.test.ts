import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { read_script, wrap_body } from "../electron/workflows/meta.ts";
import { open_sandbox } from "../electron/workflows/sandbox.ts";
import { agent_items, done_value, run_script } from "./workflow-sandbox-kit.ts";

const skill_dir = path.join(import.meta.dirname, "..", "skills", "workflow-authoring");

const documented_scripts = async (): Promise<{ file: string; source: string }[]> => {
  const found: { file: string; source: string }[] = [];
  for (const file of ["SKILL.md", "examples.md"]) {
    const text = (await fs.readFile(path.join(skill_dir, file), "utf8")).replace(/\r\n/g, "\n");
    for (const match of text.matchAll(/```js\n([\s\S]*?)```/g)) {
      const source = match[1] ?? "";
      if (source.trimStart().startsWith("export const meta")) {
        found.push({ file, source });
      }
    }
  }
  return found;
};

const compiles = (source: string): Promise<{ ok: true } | { ok: false; message: string }> => {
  const read = read_script(source);
  const sandbox = open_sandbox({ source: wrap_body(read.body), filename: "doc.js", args_text: "" }, { batch: () => undefined, broken: () => undefined });
  return sandbox.compiled.finally(() => sandbox.terminate());
};

test("every complete script in the authoring reference has valid meta and compiles in the sandbox", async () => {
  const scripts = await documented_scripts();
  assert.ok(scripts.length >= 5, `found ${scripts.length} complete scripts`);
  for (const { file, source } of scripts) {
    const name = /name:\s*'([^']+)'/.exec(source)?.[1] ?? "?";
    const result = await compiles(source);
    assert.deepEqual(result, { ok: true }, `${file} example ${name}`);
  }
});

test("a Proxy as opts cannot slip a non-string label past the synchronous check", async () => {
  const outcome = await run_script(
    "let reads = 0\nconst opts = new Proxy({ label: 'x' }, { get: (target, key) => (key === 'label' ? (reads++ === 0 ? 'ok' : { forged: true }) : target[key]) })\ntry { await agent('proxy', opts); return 'started' } catch (error) { return String(error) }",
  );
  const items = agent_items(outcome);
  assert.ok(items.every((item) => item.opts.label === undefined || typeof item.opts.label === "string"), JSON.stringify(items.map((item) => item.opts)));
  assert.equal(typeof done_value(outcome), "string");
});

test("an agent() result settled twice for the same call reaches the script once", async () => {
  const outcome = await run_script("const a = await agent('twice')\nconst b = await agent('next')\nreturn [a, b]", undefined, {
    agent: (item, sandbox) => {
      if (item.prompt === "twice") {
        sandbox.settle(item.id, true, JSON.stringify("first"));
        sandbox.settle(item.id, true, JSON.stringify("second"));
        return null;
      }
      return { ok: true, value: "n" };
    },
  });
  assert.deepEqual(done_value(outcome), ["first", "n"]);
});

test("a value with 100000 own keys and a 200000-element array cross the boundary intact", async () => {
  const outcome = await run_script("const o = {}\nfor (let i = 0; i < 100000; i++) o['k' + i] = i\nconst got = await agent('big', { label: 'big' })\nreturn { keys: Object.keys(o).length, got: got.length }", undefined, {
    agent: () => ({ ok: true, value: Array.from({ length: 200000 }, (_, i) => i) }),
  });
  assert.deepEqual(done_value(outcome), { keys: 100000, got: 200000 });
});
