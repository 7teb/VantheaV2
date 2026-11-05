import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse_catalog } from "../electron/model/catalog.ts";
import { read_catalog_source } from "../electron/model/catalog-source.ts";
import { find_model } from "../shared/models.ts";
import { image_limit, max_edge, type ImageLimit } from "../electron/model/image-limits.ts";

const catalog = parse_catalog(await read_catalog_source(fileURLToPath(new URL("../config/models", import.meta.url))));

const model_of = (id: string) => {
  const model = find_model(catalog, id);
  assert.ok(model, id);
  return model;
};

const limit_of = (id: string): ImageLimit => image_limit(model_of(id));

const values = (limit: ImageLimit) => [limit.max_images, limit.max_request_bytes, limit.max_encoded_bytes, limit.max_decoded_bytes];

test("Claude models run only on the Anthropic route and take its limits", () => {
  const haiku = limit_of("anthropic/claude-haiku-5.5");
  assert.deepEqual(values(haiku), [600, 32_000_000, 10_000_000, null]);
  assert.deepEqual(values(limit_of("anthropic/claude-sonnet-5.5")), [600, 32_000_000, 10_000_000, null]);
  assert.deepEqual(values(limit_of("anthropic/claude-opus-5.5")), [600, 32_000_000, 10_000_000, null]);
  assert.equal(max_edge(haiku, 1), 8000);
  assert.equal(max_edge(haiku, 20), 8000);
  assert.equal(max_edge(haiku, 21), 2000);
});

test("Gemini takes the Vertex per-file limit and the AI Studio request limit", () => {
  for (const id of ["google/gemini-3.8-flash", "google/gemini-3.8-flash:floor", "google/gemini-4-argon", "google/gemini-4-argon:floor"]) {
    const limit = limit_of(id);
    assert.deepEqual(values(limit), [3000, 20_000_000, null, 7_000_000], id);
    assert.equal(max_edge(limit, 100), null, id);
  }
});

test("OpenAI, DeepSeek with its Relace fallback, Kimi and Qwen follow their documented rows", () => {
  for (const id of ["openai/gpt-6.1-sol", "openai/gpt-6.1-sol:floor", "openai/gpt-6-luna"]) {
    assert.deepEqual(values(limit_of(id)), [1500, 512_000_000, null, null], id);
  }
  const deepseek = limit_of("deepseek/deepseek-v4.1-flash-1017");
  assert.deepEqual(values(deepseek), [600, 8_388_608, 33_554_432, null]);
  assert.deepEqual(values(image_limit({ ...model_of("deepseek/deepseek-v4.1-flash-1017"), provider_order: ["deepseek"] })), [600, 50_331_648, 33_554_432, null]);
  assert.equal(max_edge(deepseek, 14), 8192);
  assert.equal(max_edge(deepseek, 15), 4096);
  assert.deepEqual(values(limit_of("moonshotai/kimi-k3")), [null, 100_000_000, null, null]);
  for (const id of ["qwen/qwen3.8-max-0902"]) {
    assert.deepEqual(values(limit_of(id)), [250, 16_777_216, 20_000_000, null], id);
  }
});

test("MiMo keeps the per-image limit its xiaomi route documents and GLM 5.3 Flash has none", () => {
  assert.deepEqual(values(limit_of("xiaomi/mimo-v2.6-pro")), [null, null, 50_000_000, null]);
  const glm = limit_of("z-ai/glm-5.3-flash");
  assert.deepEqual(values(glm), [null, null, null, null]);
  assert.deepEqual(glm.edges, []);
});

test("Muse Wonder takes the image count and per-image size the Meta Model API documents", () => {
  const limit = limit_of("meta/muse-wonder");
  assert.deepEqual(values(limit), [50, null, 50_000_000, null]);
  assert.deepEqual(limit.edges, []);
});

test("routes without a documented row add no limit", () => {
  const model = find_model(catalog, "z-ai/glm-5.3-flash");
  assert.ok(model);
  assert.deepEqual(values(image_limit({ ...model, id: "anthropic/x", provider_order: ["bedrock"] })), [null, null, null, null]);
});
