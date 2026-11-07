import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Message } from "../shared/chat.ts";
import { chat_choice, find_model, message_choice, model_listing, with_choice, with_pro } from "../shared/models.ts";
import { parse_choice, parse_meta } from "../electron/chats/files.ts";
import { parse_catalog } from "../electron/model/catalog.ts";
import { read_catalog_source } from "../electron/model/catalog-source.ts";

const source = await read_catalog_source(fileURLToPath(new URL("../config/models", import.meta.url)));

const shipped = () => structuredClone(source) as { models: Record<string, unknown>[] };

const catalog = parse_catalog(shipped());

const assistant = (model: string, effort: string) => ({ id: `a-${model}`, role: "assistant", model, effort, steps: [] }) as unknown as Message;

test("every GPT 6 entry names its Pro slug and label, and no other model has one", () => {
  const with_pro_slugs = catalog.models.filter((model) => model.pro);
  assert.deepEqual(
    with_pro_slugs.map((model) => model.id),
    ["openai/gpt-6.1-sol", "openai/gpt-6.1-terra", "openai/gpt-6-luna", "openai/gpt-6-astra"],
  );
  for (const model of with_pro_slugs) {
    assert.equal(model.pro?.id, `${model.id}-pro`, model.id);
    assert.equal(model.pro?.label, `${model.label} Pro`, model.id);
  }
});

test("a Pro slug resolves to its base entry in Pro mode with the same limits", () => {
  const base = find_model(catalog, "openai/gpt-6.1-sol");
  const pro = find_model(catalog, "openai/gpt-6.1-sol-pro");
  assert.ok(base && pro);
  assert.equal(pro.id, "openai/gpt-6.1-sol-pro");
  assert.equal(pro.label, "GPT 6.1 Sol Pro");
  assert.equal(pro.pro, undefined);
  assert.deepEqual([pro.efforts, pro.context_length, pro.max_output, pro.verbosity, pro.provider_order], [base.efforts, base.context_length, base.max_output, base.verbosity, base.provider_order]);
  assert.deepEqual(with_pro(base, true), pro);
  assert.equal(with_pro(base, false), base);
  assert.deepEqual(model_listing(catalog.models, "openai/gpt-6-astra-pro:floor"), { entry: catalog.models.find((model) => model.id === "openai/gpt-6-astra"), pro: true, tier: "flex" });
  const deepseek = catalog.models.find((model) => !model.pro);
  assert.ok(deepseek);
  assert.equal(with_pro(deepseek, true), deepseek);
  assert.equal(find_model(catalog, "openai/gpt-6.1-sol-pro-pro"), null);
});

test("the catalog refuses a Pro slug that repeats another id and a Pro entry without a label", () => {
  const taken = shipped();
  const sol = taken.models.find((model) => model.id === "openai/gpt-6.1-sol");
  assert.ok(sol);
  sol.pro = { id: "openai/gpt-6.1-terra", label: "Clash" };
  assert.throws(() => parse_catalog(taken), /duplicate id openai\/gpt-6\.1-terra/);
  const unlabeled = shipped();
  const luna = unlabeled.models.find((model) => model.id === "openai/gpt-6-luna");
  assert.ok(luna);
  luna.pro = { id: "openai/gpt-6-luna-pro" };
  assert.throws(() => parse_catalog(unlabeled), /gpt-6-luna\)\.pro\.label/);
});

test("a chat without a stored choice takes the model of its last answer, Pro included", () => {
  const messages = [assistant("deepseek/deepseek-v4.1-flash-1017", "high"), assistant("openai/gpt-6.1-sol-pro", "xhigh")];
  assert.deepEqual(message_choice(catalog, messages), { model: "openai/gpt-6.1-sol", effort: "xhigh", pro: true });
  assert.equal(message_choice(catalog, [assistant("gone/model", "high")]), null);
  const fallback = { model: "deepseek/deepseek-v4.1-flash-1017", effort: "high", pro: false };
  const stored = { model: "openai/gpt-6-luna", effort: "low", pro: false };
  assert.deepEqual(chat_choice(stored, messages, catalog, fallback), stored);
  assert.deepEqual(chat_choice(undefined, messages, catalog, fallback), { model: "openai/gpt-6.1-sol", effort: "xhigh", pro: true });
  assert.deepEqual(chat_choice(undefined, [], catalog, fallback), fallback);
  assert.deepEqual(chat_choice(undefined, undefined, catalog, fallback), fallback);
});

test("a stored chat keeps a valid model choice and drops one without a model", () => {
  const base = { id: "c1", title: "Chat", project_path: "D:/p", workspace: "", pinned: false, created_at: "2026-10-28T10:00:00.000Z", message_count: 1 };
  const kept = parse_meta({ ...base, choice: { model: "openai/gpt-6.1-sol", effort: "high", pro: true } }, "2026-10-28T10:00:00.000Z");
  assert.deepEqual(kept?.choice, { model: "openai/gpt-6.1-sol", effort: "high", pro: true });
  const dropped = parse_meta({ ...base, choice: { effort: "high", pro: true } }, "2026-10-28T10:00:00.000Z");
  assert.equal(dropped && "choice" in dropped, false);
  assert.deepEqual(parse_choice({ model: "x/y", pro: "yes" }), { model: "x/y", effort: "", pro: false });
  assert.equal(parse_choice("x/y"), null);
});

test("Fast, Ultrafast and Flex route the same model to the provider's other endpoints where OpenRouter offers them", () => {
  assert.deepEqual(
    catalog.models.filter((model) => model.tiers).map((model) => [model.id, Object.keys(model.tiers ?? {}).join(",")]),
    [
      ["deepseek/deepseek-v4.1-flash-1017", "fast"],
      ["xiaomi/mimo-v2.6-pro", "fast"],
      ["openai/gpt-6.1-sol", "fast,ultrafast,flex"],
      ["openai/gpt-6.1-terra", "fast,flex"],
      ["openai/gpt-6-luna", "fast"],
      ["openai/gpt-6-astra", "fast,ultrafast,flex"],
      ["google/gemini-4-argon", "flex"],
    ],
  );
  const sol = catalog.models.find((model) => model.id === "openai/gpt-6.1-sol");
  assert.ok(sol);
  const fast_pro = with_choice(sol, { pro: true, tier: "fast" });
  assert.deepEqual([fast_pro.id, fast_pro.label, fast_pro.provider_order], ["openai/gpt-6.1-sol-pro", "GPT 6.1 Sol Pro Fast", ["openai/fast"]]);
  const ultrafast = with_choice(sol, { pro: false, tier: "ultrafast" });
  assert.deepEqual([ultrafast.id, ultrafast.label, ultrafast.provider_order], ["openai/gpt-6.1-sol", "GPT 6.1 Sol Ultrafast", ["openai/ultrafast"]]);
  assert.equal(ultrafast.max_output, sol.max_output);
  const deepseek = catalog.models.find((model) => model.id === "deepseek/deepseek-v4.1-flash-1017");
  assert.ok(deepseek);
  const deepseek_fast = with_choice(deepseek, { pro: false, tier: "fast" });
  assert.deepEqual(
    [deepseek_fast.label, deepseek_fast.provider_order, deepseek_fast.max_output],
    ["DeepSeek V4.1 Flash Fast", ["baseten/fast"], 262144],
  );
  const mimo = catalog.models.find((model) => model.id === "xiaomi/mimo-v2.6-pro");
  assert.ok(mimo);
  const mimo_fast = with_choice(mimo, { pro: false, tier: "fast" });
  assert.deepEqual([mimo_fast.id, mimo_fast.label, mimo_fast.provider_order], ["xiaomi/mimo-v2.6-pro-ultraspeed", "MiMo V2.6 Pro Fast", ["xiaomi"]]);
  assert.deepEqual(model_listing(catalog.models, "xiaomi/mimo-v2.6-pro-ultraspeed"), { entry: mimo, pro: false, tier: "fast" });
  const terra = catalog.models.find((model) => model.id === "openai/gpt-6.1-terra");
  assert.ok(terra);
  assert.equal(with_choice(terra, { pro: false, tier: "ultrafast" }), terra);
  assert.deepEqual(with_choice(sol, { pro: false }), sol);
  assert.deepEqual(parse_choice({ model: "openai/gpt-6-luna", effort: "high", pro: false, tier: "fast" }), { model: "openai/gpt-6-luna", effort: "high", pro: false, tier: "fast" });
  assert.deepEqual(parse_choice({ model: "openai/gpt-6-luna", effort: "high", pro: false, tier: "warp" }), { model: "openai/gpt-6-luna", effort: "high", pro: false });
  const wrong = shipped();
  const luna = wrong.models.find((model) => model.id === "openai/gpt-6-luna");
  assert.ok(luna);
  luna.tiers = { warp: ["openai/warp"] };
  assert.throws(() => parse_catalog(wrong), /tiers\.warp: must be one of fast, ultrafast, flex/);
  luna.tiers = { fast: "openai/fast" };
  assert.throws(() => parse_catalog(wrong), /tiers\.fast: must be an array of strings or an object with provider_order/);
  luna.tiers = { fast: { id: "openai/gpt-6-luna-fast" } };
  assert.throws(() => parse_catalog(wrong), /tiers\.fast\.provider_order: must be an array of strings/);
});
