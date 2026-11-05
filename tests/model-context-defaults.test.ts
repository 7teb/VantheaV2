import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { context_setting, find_model, with_compact_percent, with_context_limit, with_context_setting } from "../shared/models.ts";
import { parse_catalog } from "../electron/model/catalog.ts";
import { read_catalog_source } from "../electron/model/catalog-source.ts";

const source = await read_catalog_source(fileURLToPath(new URL("../config/models", import.meta.url)));

const catalog = parse_catalog(source);

const entry = (id: string) => {
  const model = catalog.models.find((candidate) => candidate.id === id);
  assert.ok(model, id);
  return model;
};

test("the shipped catalog sets context defaults for exactly the agreed models", () => {
  assert.deepEqual(
    catalog.models.filter((model) => model.default_context).map((model) => [model.id, model.default_context?.limit, model.default_context?.compact_percent]),
    [
      ["deepseek/deepseek-v4.1-flash-1017", 512_000, 95],
      ["minimax/minimax-m3.1-flash", 400_000, 90],
      ["openai/gpt-6.1-sol", 272_000, 80],
      ["openai/gpt-6.1-terra", 272_000, 80],
      ["openai/gpt-6-luna", 272_000, 80],
      ["openai/gpt-6-astra", 272_000, 80],
      ["anthropic/claude-haiku-5.5", 100_000, 95],
      ["anthropic/claude-sonnet-5.5", null, 95],
      ["anthropic/claude-opus-5.5", null, 95],
    ],
  );
});

test("without a setting of the user the catalog default limits the context and sets the compaction point", () => {
  const sol = entry("openai/gpt-6.1-sol");
  const limited = with_context_setting(sol, context_setting(sol, undefined));
  assert.deepEqual([limited.context_length, limited.compact_at], [272_000, 0.8]);
  const opus = with_context_setting(entry("anthropic/claude-opus-5.5"), context_setting(entry("anthropic/claude-opus-5.5"), undefined));
  assert.deepEqual([opus.context_length, opus.compact_at], [1_000_000, 0.95]);
  const glm = entry("z-ai/glm-5.3-flash");
  assert.equal(with_context_setting(glm, context_setting(glm, undefined)), glm);
  assert.equal(find_model(catalog, "openai/gpt-6.1-sol-pro")?.default_context?.limit, 272_000);
});

test("a setting of the user wins over the default, and changing one value keeps the other default", () => {
  const sol = entry("openai/gpt-6.1-sol");
  assert.deepEqual(context_setting(sol, { limit: null, compact_percent: 70 }), { limit: null, compact_percent: 70 });
  const full = with_context_limit(sol, context_setting(sol, undefined), null);
  assert.deepEqual(full, { limit: null, compact_percent: 80 });
  assert.equal(with_context_setting(sol, context_setting(sol, full)).context_length, 1_050_000);
  assert.deepEqual(with_compact_percent(context_setting(sol, undefined), 90), { limit: 272_000, compact_percent: 90 });
});

test("a default outside the model's window or the compaction range fails the catalog", () => {
  const with_default = (value: unknown) => {
    const copy = structuredClone(source) as { models: Record<string, unknown>[] };
    const sol = copy.models.find((model) => model.id === "openai/gpt-6.1-sol");
    assert.ok(sol);
    sol.default_context = value;
    return copy;
  };
  assert.throws(() => parse_catalog(with_default({ limit: 2_000_000, compact_percent: 80 })), /default_context\.limit: must be null or at least 16000/);
  assert.throws(() => parse_catalog(with_default({ limit: 8000, compact_percent: 80 })), /default_context\.limit/);
  assert.throws(() => parse_catalog(with_default({ limit: 272_000, compact_percent: 99 })), /default_context\.compact_percent: must be an integer from 50 to 95/);
  assert.throws(() => parse_catalog(with_default({ limit: "272k", compact_percent: 80 })), /default_context\.limit: must be a positive integer/);
});
