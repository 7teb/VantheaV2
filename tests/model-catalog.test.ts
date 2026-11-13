import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { api_effort, major_effort, parse_catalog, resolve_effort, side_window } from "../electron/model/catalog.ts";
import { read_catalog_source } from "../electron/model/catalog-source.ts";
import { find_model } from "../shared/models.ts";

const config_dir = fileURLToPath(new URL("../config/models", import.meta.url));

const source = await read_catalog_source(config_dir);

const shipped = () => structuredClone(source);

const minimal = (patch: Record<string, unknown> = {}) => ({
  models: [
    {
      id: "a/one",
      label: "One",
      provider: "A",
      provider_order: [],
      efforts: ["low", "high"],
      default_effort: "high",
      vision: false,
      context_length: 1000,
      max_output: 100,
      ...patch,
    },
  ],
  side: { title: "s/t", overseer: "s/o", vision: "s/v", memory: "s/m", reasoning_status: "s/r", transcription: "s/x", git_text: "s/g" },
  image_models: [],
});

test("the shipped catalog parses and holds no NVIDIA entry", () => {
  const catalog = parse_catalog(shipped());
  assert.ok(catalog.models.length > 0);
  assert.equal(
    catalog.models.some((model) => /nvidia/i.test(`${model.id} ${model.provider}`)),
    false,
  );
  for (const model of catalog.models) {
    if (!model.efforts.length) {
      assert.equal(model.default_effort, "", model.id);
      continue;
    }
    assert.equal(model.efforts.at(-1), major_effort, model.id);
    assert.ok(model.efforts.includes(model.default_effort), model.id);
  }
  assert.deepEqual(catalog.models.filter((model) => !model.efforts.length).map((model) => model.id), []);
  assert.deepEqual(Object.keys(catalog.side).sort(), ["git_text", "memory", "overseer", "reasoning_status", "title", "transcription", "vision"]);
  assert.equal(catalog.side.title, "google/gemini-3.1-flash-lite");
  assert.equal(catalog.side.reasoning_status, "google/gemini-3.5-flash-lite");
  assert.equal(catalog.image_models.find((entry) => entry.quality)?.id, "openai/gpt-image-2");
});

test("git_text is a required side role and its window comes from models or side_models", () => {
  const shipped_catalog = parse_catalog(shipped());
  assert.equal(shipped_catalog.side.git_text, "google/gemini-3.5-flash-lite");
  assert.deepEqual(side_window(shipped_catalog, "git_text"), { id: "google/gemini-3.5-flash-lite", context_length: 1048576, max_output: 65536 });
  assert.equal(side_window(shipped_catalog, "overseer").id, "openai/gpt-6-luna");
  const without = Object.fromEntries(Object.entries(minimal().side).filter(([role]) => role !== "git_text"));
  assert.throws(() => parse_catalog({ ...minimal(), side: without }), /side\.git_text/);
  assert.throws(() => side_window(parse_catalog(minimal()), "git_text"), /side\.git_text names s\/g, which has no entry/);
  const listed = parse_catalog({ ...minimal(), side_models: [{ id: "s/g", context_length: 4000, max_output: 500 }] });
  assert.deepEqual(side_window(listed, "git_text"), { id: "s/g", context_length: 4000, max_output: 500 });
  assert.deepEqual(side_window(parse_catalog({ ...minimal(), side: { ...minimal().side, git_text: "a/one" } }), "git_text"), { id: "a/one", context_length: 1000, max_output: 100 });
  assert.throws(() => parse_catalog({ ...minimal(), side_models: [{ id: "s/g", context_length: 0, max_output: 1 }] }), /side_models\[0\] \(s\/g\)\.context_length/);
  assert.throws(() => parse_catalog({ ...minimal(), side_models: {} }), /side_models: must be an array/);
});

test("major maps to the highest real effort and unknown efforts fall back to the default", () => {
  const catalog = parse_catalog(shipped());
  const deepseek = find_model(catalog, "deepseek/deepseek-v4.1-flash-1017");
  const gpt = find_model(catalog, "openai/gpt-6.1-sol");
  assert.ok(deepseek && gpt);
  assert.equal(api_effort(deepseek, major_effort), "max");
  assert.equal(api_effort(gpt, major_effort), "max");
  assert.equal(api_effort(deepseek, "high"), "high");
  assert.equal(resolve_effort(deepseek, "minimal"), "high");
  assert.equal(api_effort(gpt, "minimal"), "high");
  assert.equal(find_model(catalog, "missing/model"), null);
});

test("reasoning passback defaults to off and is on for the shipped DeepSeek, Kimi K3.1 Pro and MiniMax M3.1 Flash models", () => {
  assert.equal(parse_catalog(minimal()).models[0]?.reasoning_passback, false);
  const catalog = parse_catalog(shipped());
  const passback = catalog.models.filter((model) => model.reasoning_passback).map((model) => model.id);
  assert.deepEqual(passback, ["deepseek/deepseek-v4.1-flash-1017", "moonshotai/kimi-k3.1-pro", "minimax/minimax-m3.1-flash"]);
});

test("verbosity is optional and set to low only on the shipped GPT-6 models", () => {
  assert.equal(parse_catalog(minimal()).models[0]?.verbosity, undefined);
  assert.equal(parse_catalog(minimal({ verbosity: "low" })).models[0]?.verbosity, "low");
  assert.throws(() => parse_catalog(minimal({ verbosity: "short" })), /a\/one\)\.verbosity: must be one of low, medium, high, xhigh, max/);
  const low = parse_catalog(shipped()).models.filter((model) => model.verbosity === "low").map((model) => model.id);
  assert.deepEqual(low, [
    "openai/gpt-6.1-sol",
    "openai/gpt-6.1-terra",
    "openai/gpt-6-luna",
    "openai/gpt-6-astra",
  ]);
});

test("a model without efforts gets no synthetic effort", () => {
  const catalog = parse_catalog(minimal({ efforts: [], default_effort: "" }));
  assert.deepEqual(catalog.models[0]?.efforts, []);
});

test("invalid entries throw an error naming the entry", () => {
  const cases: [unknown, RegExp][] = [
    [minimal({ id: "" }), /models\[0\]\.id/],
    [minimal({ efforts: ["low", "ultra"] }), /models\[0\] \(a\/one\)\.efforts/],
    [minimal({ efforts: ["high", "low"], default_effort: "low" }), /ordered from lowest to highest/],
    [minimal({ default_effort: "medium" }), /a\/one\)\.default_effort/],
    [minimal({ context_length: 0 }), /a\/one\)\.context_length/],
    [minimal({ vision: "yes" }), /a\/one\)\.vision/],
    [minimal({ provider_order: "deepseek" }), /a\/one\)\.provider_order/],
    [minimal({ reasoning_passback: "yes" }), /a\/one\)\.reasoning_passback/],
    [{ ...minimal(), side: { title: "x" } }, /side\.overseer/],
    [{ ...minimal(), image_models: [{ id: "i/1", label: "I" }] }, /image_models\[0\] \(i\/1\)\.quality/],
    [{ ...minimal(), models: [] }, /models: must be a non-empty array/],
  ];
  for (const [input, pattern] of cases) {
    assert.throws(() => parse_catalog(input), pattern);
  }
  const duplicate = minimal();
  duplicate.models.push({ ...duplicate.models[0]! });
  assert.throws(() => parse_catalog(duplicate), /duplicate id a\/one/);
});

test("a fallback names another catalog model and resolves to its route", () => {
  const entry = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), provider: "Z.ai", provider_order: [`${id}-provider`], efforts: [], vision: false, context_length: 1000, max_output: 100, ...extra });
  const catalog = (models: unknown[]) => ({ models, side: { title: "a", overseer: "a", vision: "a", memory: "a", reasoning_status: "a", transcription: "a", git_text: "a" }, image_models: [] });
  const parsed = parse_catalog(catalog([entry("glm"), entry("glm-fast", { fallback: "glm" })]));
  assert.deepEqual(parsed.models[1]?.fallback, { id: "glm", label: "GLM", provider_order: ["glm-provider"] });
  assert.equal(parsed.models[0]?.fallback, undefined);
  assert.throws(() => parse_catalog(catalog([entry("glm-fast", { fallback: "missing" })])), /fallback: must name another model id/);
  assert.throws(() => parse_catalog(catalog([entry("glm-fast", { fallback: "glm-fast" })])), /fallback: must name another model id/);
  assert.throws(() => parse_catalog(catalog([entry("a", { fallback: "b" }), entry("b", { fallback: "c" }), entry("c")])), /must name a model without its own fallback/);
});

test("exactly the shipped vision models take images, so a flag flip or a new model fails here", () => {
  const vision = parse_catalog(shipped()).models.filter((model) => model.vision).map((model) => model.id);
  assert.deepEqual(vision, [
    "deepseek/deepseek-v4.1-flash-1017",
    "moonshotai/kimi-k3.1-pro",
    "xiaomi/mimo-v2.6-pro",
    "minimax/minimax-m3.1-flash",
    "qwen/qwen3.8-max-0902",
    "openai/gpt-6.1-sol",
    "openai/gpt-6.1-terra",
    "openai/gpt-6-luna",
    "openai/gpt-6-astra",
    "google/gemini-4-argon",
    "google/gemini-4-carbon",
    "google/gemini-4-hydrogen",
    "x-ai/grok-4.7",
    "z-ai/glm-5.3-flash",
    "anthropic/claude-haiku-5.5",
    "anthropic/claude-sonnet-5.5",
    "anthropic/claude-opus-5.5",
    "anthropic/claude-fable-5.2",
    "stealth/crouton-alpha",
  ]);
});

test("a vision model may not fall back to a model without vision", () => {
  const entry = (id: string, vision: boolean, extra: Record<string, unknown> = {}) => ({ id, label: id, provider: "P", provider_order: [], efforts: [], vision, context_length: 1000, max_output: 100, ...extra });
  const catalog = (models: unknown[]) => ({ models, side: { title: "a", overseer: "a", vision: "a", memory: "a", reasoning_status: "a", transcription: "a", git_text: "a" }, image_models: [] });
  assert.throws(() => parse_catalog(catalog([entry("blind", false), entry("seer", true, { fallback: "blind" })])), /seer\)\.fallback: must name a model that takes images/);
  assert.equal(parse_catalog(catalog([entry("seer-b", true), entry("seer", true, { fallback: "seer-b" })])).models[1]?.fallback?.id, "seer-b");
  assert.equal(parse_catalog(catalog([entry("seer", true), entry("blind", false, { fallback: "seer" })])).models[1]?.fallback?.id, "seer");
});

test("the catalog folder lists every model file once and each model sits in the file of its vendor", () => {
  const index = JSON.parse(readFileSync(path.join(config_dir, "index.json"), "utf8")) as { model_files: string[] };
  const files = readdirSync(config_dir).filter((name) => name !== "index.json");
  assert.deepEqual([...index.model_files].sort(), files.sort());
  for (const name of index.model_files) {
    const models = JSON.parse(readFileSync(path.join(config_dir, name), "utf8")) as { id: string }[];
    for (const model of models) {
      assert.equal(`${model.id.split("/")[0]}.json`, name, model.id);
    }
  }
  const catalog = parse_catalog(shipped());
  assert.equal(catalog.models[0]?.id, "deepseek/deepseek-v4.1-flash-1017");
  assert.equal(catalog.models.at(-1)?.id, "stealth/crouton-alpha");
});

test("the catalog reader joins the model files in index order and names the file that failed", async () => {
  const folder = (index: unknown, files: Record<string, string> = {}) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "vx-catalog-"));
    writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), text);
    }
    return dir;
  };
  const joined = await read_catalog_source(folder({ model_files: ["b.json", "a.json"], side: { title: "x" } }, { "a.json": '[{"id":"a/1"}]', "b.json": '[{"id":"b/1"},{"id":"b/2"}]' }));
  assert.deepEqual(joined, { side: { title: "x" }, models: [{ id: "b/1" }, { id: "b/2" }, { id: "a/1" }] });
  await assert.rejects(read_catalog_source(folder({ model_files: ["a.json"] }, { "a.json": "{}" })), /a\.json: must be an array of models/);
  await assert.rejects(read_catalog_source(folder({ model_files: ["missing.json"] })), /missing\.json: ENOENT/);
  await assert.rejects(read_catalog_source(folder({ model_files: "a.json" })), /index\.json: model_files must be an array of file names/);
  await assert.rejects(read_catalog_source(folder([])), /index\.json: must be an object/);
});
