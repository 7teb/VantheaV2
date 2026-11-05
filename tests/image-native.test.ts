import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse_catalog } from "../electron/model/catalog.ts";
import { read_catalog_source } from "../electron/model/catalog-source.ts";
import { find_model } from "../shared/models.ts";
import { image_rules } from "../electron/model/image-limits.ts";
import { default_native, fit_image } from "../shared/image-fit.ts";
import { largest_native, native_rules, native_size } from "../shared/image-native.ts";

const catalog = parse_catalog(await read_catalog_source(fileURLToPath(new URL("../config/models", import.meta.url))));

test("every Claude model in the catalog is 4.7 or later and gets the high-resolution tier", () => {
  const claude = catalog.models.filter((model) => model.id.startsWith("anthropic/"));
  assert.ok(claude.length > 0);
  for (const model of claude) {
    const version = /claude-[a-z]+-(\d+)(?:\.(\d+))?/.exec(model.id);
    assert.ok(version, model.id);
    const major = Number(version[1]);
    const minor = Number(version[2] ?? 0);
    assert.ok(major > 4 || (major === 4 && minor >= 7), model.id);
    assert.deepEqual(native_rules(model), [{ max_edge: 2576, patch: 28, max_patches: 4784 }], model.id);
  }
});

test("documented families get their native size and the rest keep the default", () => {
  assert.deepEqual(native_size("qwen/qwen3.8-max"), { max_edge: 7680, patch: 32, max_patches: 2560 });
  assert.deepEqual(native_size("deepseek/deepseek-v4.1-flash-1017"), { max_edge: 4096, patch: 1, max_patches: 1_690_000 });
  for (const id of ["openai/gpt-6.1-sol", "google/gemini-3.8-flash", "moonshotai/kimi-k3", "xiaomi/mimo-v2.6-pro", "z-ai/glm-5.3-flash"]) {
    assert.deepEqual(native_size(id), default_native, id);
  }
  assert.deepEqual(fit_image(4000, 3000, [native_size("qwen/qwen3.8-max")]), { width: 1856, height: 1392 });
  assert.deepEqual(fit_image(4000, 3000, [native_size("deepseek/deepseek-v4.1-flash-1017")]), { width: 1500, height: 1125 });
});

test("a model with a fallback route fits images for both models", () => {
  const glm = find_model(catalog, "z-ai/glm-5.3:nitro");
  assert.ok(glm?.fallback);
  assert.equal(native_rules(glm).length, 2);
  const mixed = { ...glm, id: "anthropic/claude-opus-5.5", fallback: { ...glm.fallback, id: "qwen/qwen3.8-max" } };
  assert.deepEqual(native_rules(mixed), [native_size("anthropic/claude-opus-5.5"), native_size("qwen/qwen3.8-max")]);
});

test("an attachment stored at the largest native size is never smaller than what any catalog model takes", () => {
  for (const [width, height] of [
    [6000, 4000],
    [3840, 2160],
    [12000, 900],
    [900, 12000],
    [2000, 2000],
  ] as const) {
    const stored = fit_image(width, height, [largest_native]);
    for (const model of catalog.models.filter((entry) => entry.vision)) {
      const direct = fit_image(width, height, native_rules(model));
      const refit = fit_image(stored.width, stored.height, native_rules(model));
      assert.ok(stored.width >= direct.width && stored.height >= direct.height, `${model.id} ${width}x${height}`);
      assert.ok(Math.abs(refit.width - direct.width) <= 2 && Math.abs(refit.height - direct.height) <= 2, `${model.id} ${width}x${height}: ${JSON.stringify(refit)} vs ${JSON.stringify(direct)}`);
    }
  }
});

test("tool images for Claude stay at the native size up to 20 images and fit the 2000 px many-image edge from the 21st on", () => {
  const opus = find_model(catalog, "anthropic/claude-opus-5.5");
  assert.ok(opus);
  assert.deepEqual(fit_image(2560, 1600, image_rules(opus, 20)), { width: 2420, height: 1512 });
  assert.deepEqual(fit_image(2560, 1600, image_rules(opus, 21)), { width: 2000, height: 1250 });
  assert.deepEqual(fit_image(3840, 2160, image_rules(opus, 40)), { width: 2000, height: 1125 });
  const gpt = find_model(catalog, "openai/gpt-6.1-sol");
  assert.ok(gpt);
  assert.deepEqual(image_rules(gpt, 100), native_rules(gpt));
});
