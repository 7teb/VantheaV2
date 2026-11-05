import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compact_percent_of, with_compact_percent, with_context_limit, with_context_setting, type ModelEntry } from "../shared/models.ts";
import { min_context_limit } from "../shared/settings.ts";
import { compact_tokens } from "../src/components/token-count.ts";
import { auto_compact_options, context_limit_options } from "../src/features/composer/context-options.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const model = (context_length: number): ModelEntry => ({
  id: "vendor/model",
  label: "Model",
  provider: "p",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: false,
  context_length,
  max_output: 4096,
  reasoning_passback: false,
});

const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("auto-compact offers fixed percentages, marks the default 70 and hints the token point", () => {
  const options = auto_compact_options(t, model(200_000), undefined);
  assert.deepEqual(
    options.map((option) => option.percent),
    [50, 60, 70, 80, 90, 95],
  );
  assert.deepEqual(
    options.filter((option) => option.selected).map((option) => option.percent),
    [70],
  );
  assert.equal(options.find((option) => option.percent === 70)?.label, "70%");
  assert.equal(options.find((option) => option.percent === 70)?.hint, "at 140k tokens");
  assert.equal(new Set(options.map((option) => option.id)).size, options.length);
});

test("auto-compact keeps an earlier slider value in the list and measures against the chosen limit", () => {
  const options = auto_compact_options(t, model(1_000_000), { limit: 100_000, compact_percent: 65 });
  assert.deepEqual(
    options.map((option) => option.percent),
    [50, 60, 65, 70, 80, 90, 95],
  );
  assert.equal(options.find((option) => option.selected)?.percent, 65);
  assert.equal(options.find((option) => option.percent === 50)?.hint, "at 50k tokens");
});

test("the context limit list starts with the model maximum and only offers smaller presets", () => {
  const options = context_limit_options(t, model(272_000), undefined);
  assert.equal(options[0]?.limit, null);
  assert.equal(options[0]?.label, "Model maximum");
  assert.equal(options[0]?.hint, "272k tokens");
  assert.equal(options[0]?.selected, true);
  assert.deepEqual(
    options.slice(1).map((option) => option.limit),
    [200_000, 128_000, 64_000, 32_000],
  );
  assert.ok(options.every((option) => option.limit === null || (option.limit >= min_context_limit && option.limit < 272_000)));
  assert.equal(options[1]?.label, "200k tokens");
});

test("the context limit list marks the stored limit and keeps a custom one in order", () => {
  const options = context_limit_options(t, model(1_000_000), { limit: 150_000, compact_percent: 70 });
  assert.deepEqual(
    options.map((option) => option.limit),
    [null, 400_000, 272_000, 200_000, 150_000, 128_000, 64_000, 32_000],
  );
  assert.deepEqual(
    options.filter((option) => option.selected).map((option) => option.limit),
    [150_000],
  );
});

test("a stored limit at or above the model window counts as the model maximum", () => {
  const options = context_limit_options(t, model(128_000), { limit: 400_000, compact_percent: 70 });
  assert.equal(options.find((option) => option.selected)?.limit, null);
});

test("the setting writers keep the other field and clamp a limit to the model window and the minimum", () => {
  const entry = model(272_000);
  assert.equal(compact_percent_of(undefined), 70);
  assert.deepEqual(with_compact_percent(undefined, 80), { limit: null, compact_percent: 80 });
  assert.deepEqual(with_compact_percent({ limit: 128_000, compact_percent: 70 }, 90), { limit: 128_000, compact_percent: 90 });
  assert.deepEqual(with_context_limit(entry, { limit: null, compact_percent: 85 }, 128_000), { limit: 128_000, compact_percent: 85 });
  assert.deepEqual(with_context_limit(entry, undefined, 272_000), { limit: null, compact_percent: 70 });
  assert.deepEqual(with_context_limit(entry, undefined, 1_000_000), { limit: null, compact_percent: 70 });
  assert.deepEqual(with_context_limit(entry, undefined, 1000), { limit: min_context_limit, compact_percent: 70 });
  assert.deepEqual(with_context_limit(entry, { limit: 64_000, compact_percent: 60 }, null), { limit: null, compact_percent: 60 });
  assert.equal(with_context_setting(entry, with_context_limit(entry, undefined, 128_000)).context_length, 128_000);
});

test("token counts read as k and M", () => {
  assert.equal(compact_tokens(950), "950");
  assert.equal(compact_tokens(272_000), "272k");
  assert.equal(compact_tokens(1_000_000), "1.0M");
  assert.equal(compact_tokens(12_000_000), "12M");
});

test("the context ring popup no longer holds the limit and auto-compact fields", () => {
  const ring = read("components/ContextRing.tsx");
  const composer = read("features/composer/Composer.tsx");
  assert.doesNotMatch(ring, /children/);
  assert.doesNotMatch(composer, /ContextLimitFields|set_model_context/);
  assert.match(ring, /context\.compact_now/);
  assert.match(ring, /context-popover-usage/);
});
