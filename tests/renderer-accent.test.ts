import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";

const globals = ["document", "localStorage"];
const descriptors = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

after(() => {
  for (const name of globals) {
    const descriptor = descriptors.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("the renderer applies the accent to the root element and remembers it for the next start", async () => {
  const properties = new Map<string, string>();
  const stored = new Map<string, string>([["vx:accent", "#f85149"]]);
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { style: { setProperty: (name: string, value: string) => properties.set(name, value), removeProperty: (name: string) => properties.delete(name) } } },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  const result = await build({ stdin: { contents: 'export * from "./src/state/accent.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "esm", write: false, logLevel: "silent" });
  const accent = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  assert.equal(properties.get("--accent"), "#f85149");
  accent.set_accent("#22b8cf");
  assert.equal(properties.get("--accent"), "#22b8cf");
  assert.equal(stored.get("vx:accent"), "#22b8cf");
  accent.set_accent("");
  assert.equal(properties.has("--accent"), false);
  assert.equal(stored.has("vx:accent"), false);
  stored.set("vx:accent", "purple");
  properties.set("--accent", "#000000");
  await import("data:text/javascript;base64," + Buffer.from(`${result.outputFiles[0].text}\n`).toString("base64"));
  assert.equal(properties.has("--accent"), false);
});
