import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Message } from "../shared/chat.ts";
import { find_model, message_choice, with_choice } from "../shared/models.ts";
import { parse_choice } from "../electron/chats/files.ts";
import { parse_catalog } from "../electron/model/catalog.ts";
import { read_catalog_source } from "../electron/model/catalog-source.ts";
import { default_settings, normalize_settings } from "../electron/settings/validate.ts";
import { model_switch_note } from "../electron/turn/model-switch.ts";

const catalog = parse_catalog(await read_catalog_source(fileURLToPath(new URL("../config/models", import.meta.url))));

const entry = (id: string) => {
  const model = catalog.models.find((candidate) => candidate.id === id);
  assert.ok(model, id);
  return model;
};

const assistant = (model: string) => ({ id: `a-${model}`, role: "assistant", model, effort: "high", steps: [] }) as unknown as Message;

test("the picker lists no Flex entries, the Flex route is a tier of the base model", () => {
  assert.deepEqual(
    catalog.models.filter((model) => model.label.endsWith(" Flex") || model.id.endsWith(":floor")),
    [],
  );
  assert.deepEqual(
    catalog.models.filter((model) => model.tiers?.flex).map((model) => model.id),
    ["openai/gpt-6.1-sol", "openai/gpt-6.1-terra", "openai/gpt-6-astra", "google/gemini-3.8-flash", "google/gemini-4-argon"],
  );
});

test("/flex turns the chosen model into its Flex variant, also in Pro mode", () => {
  const astra = entry("openai/gpt-6-astra");
  const flex = with_choice(astra, { pro: false, tier: "flex" });
  assert.deepEqual([flex.id, flex.label, flex.provider_order], ["openai/gpt-6-astra", "GPT 6 Astra Flex", ["openai/flex", "openai"]]);
  const pro_flex = with_choice(astra, { pro: true, tier: "flex" });
  assert.deepEqual([pro_flex.id, pro_flex.label, pro_flex.provider_order], ["openai/gpt-6-astra-pro", "GPT 6 Astra Pro Flex", ["openai/flex", "openai"]]);
  const argon = with_choice(entry("google/gemini-4-argon"), { pro: false, tier: "flex" });
  assert.deepEqual([argon.label, argon.provider_order], ["Gemini 4 Argon Flex", ["google-ai-studio/flex", "google-vertex/global", "google-ai-studio"]]);
  assert.equal(with_choice(entry("openai/gpt-6-luna"), { pro: false, tier: "flex" }).label, "GPT 6 Luna");
});

test("a :floor id still names the Flex variant for sub-agents and stored messages", () => {
  const sol = find_model(catalog, "openai/gpt-6.1-sol:floor");
  assert.deepEqual([sol?.id, sol?.label, sol?.provider_order], ["openai/gpt-6.1-sol", "GPT 6.1 Sol Flex", ["openai/flex", "openai"]]);
  assert.equal(find_model(catalog, "openai/gpt-6.1-sol-pro:floor")?.label, "GPT 6.1 Sol Pro Flex");
  assert.equal(find_model(catalog, "openai/gpt-6-luna:floor"), null);
  assert.deepEqual(message_choice(catalog, [assistant("openai/gpt-6.1-terra:floor")]), { model: "openai/gpt-6.1-terra", effort: "high", pro: false, tier: "flex" });
});

test("a chat or settings file that stored a Flex entry loads as the base model with the Flex tier", () => {
  assert.deepEqual(parse_choice({ model: "openai/gpt-6.1-terra:floor", effort: "high", pro: true }), { model: "openai/gpt-6.1-terra", effort: "high", pro: true, tier: "flex" });
  assert.deepEqual(parse_choice({ model: "openai/gpt-6.1-terra", effort: "high", pro: false, tier: "fast" }), { model: "openai/gpt-6.1-terra", effort: "high", pro: false, tier: "fast" });
  assert.equal(normalize_settings({ model: "google/gemini-4-argon:floor" }, default_settings()).model, "google/gemini-4-argon");
});

test("going from a stored Flex entry to the same model with the Flex tier is no model switch", () => {
  const flex = with_choice(entry("openai/gpt-6.1-sol"), { pro: false, tier: "flex" });
  assert.equal(model_switch_note([assistant("openai/gpt-6.1-sol:floor")], flex, catalog), null);
  assert.notEqual(model_switch_note([assistant("openai/gpt-6-astra:floor")], flex, catalog), null);
});
