import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountModel } from "../shared/chatgpt.ts";
import type { ModelEntry } from "../shared/models.ts";
import { pick_plan_side, plan_models, unlisted_slugs } from "../electron/billing/offered.ts";
import { plan_eligible, plan_slug, type PlanSide } from "../electron/model/catalog.ts";

const entry = (id: string, extra: Partial<ModelEntry> = {}): ModelEntry => ({
  id,
  label: id,
  provider: id.split("/")[0] ?? id,
  provider_order: ["openai"],
  efforts: ["low", "medium", "high", "major"],
  default_effort: "medium",
  vision: true,
  context_length: 1050000,
  max_output: 128000,
  reasoning_passback: false,
  ...extra,
});

const sol = entry("openai/gpt-6.2-sol", { pro: { id: "openai/gpt-6.2-sol-pro", label: "GPT-6.2 Sol Pro" }, tiers: { fast: { provider_order: ["openai"] }, flex: { provider_order: ["openai"] } } });

const luna = entry("openai/gpt-6-luna", { pro: { id: "openai/gpt-6-luna-pro", label: "GPT-6 Luna Pro" }, tiers: { fast: { provider_order: ["openai"] } } });

const astra = entry("openai/gpt-6-astra", { vision: false });

const oss = entry("openai/gpt-oss-120b", { provider_order: ["cerebras/fp16"], efforts: ["low", "medium", "major"], vision: false, context_length: 131072 });

const deepseek = entry("deepseek/deepseek-v4.1-flash-1017", { provider: "deepseek", provider_order: ["deepseek"], tiers: { fast: { provider_order: ["deepseek"] } } });

const catalog: ModelEntry[] = [deepseek, sol, luna, astra, oss];

const listed = (slug: string, context_window: number | null = null): AccountModel => ({ slug, display_name: slug, context_window });

const ids = (models: readonly ModelEntry[]) => models.map((model) => model.id);

const plan_side: PlanSide = {
  title: { model: "openai/gpt-6-luna", effort: "none" },
  overseer: { model: "openai/gpt-6-luna", effort: "low" },
  vision: { model: "openai/gpt-6-luna", effort: "none" },
  git_text: { model: "openai/gpt-6-luna", effort: "none" },
};

test("the side pool follows the order of the account list, not the catalog", () => {
  const { side_pool } = plan_models(catalog, [listed("gpt-6-astra"), listed("gpt-6.2-sol"), listed("gpt-6-luna")]);
  assert.deepEqual(ids(side_pool), ["openai/gpt-6-astra", "openai/gpt-6.2-sol", "openai/gpt-6-luna"]);
});

const without_pro = (model: ModelEntry): ModelEntry => {
  const { pro, ...rest } = model;
  return rest;
};

test("plan entries keep their speed tiers and everything else except a Pro the account does not list", () => {
  const { models, pro_locked } = plan_models(catalog, [listed("gpt-6.2-sol")]);
  const plan_sol = models.find((model) => model.id === "openai/gpt-6.2-sol");
  assert.ok(plan_sol);
  assert.deepEqual(plan_sol.tiers, sol.tiers);
  assert.equal(plan_sol.pro, undefined);
  assert.deepEqual({ ...plan_sol }, without_pro(sol));
  assert.deepEqual(pro_locked, ["openai/gpt-6.2-sol"]);
});

test("the pro variant stays and runs on the plan only when the account lists the pro slug, otherwise it is locked", () => {
  const { models, plan_ids, pro_locked } = plan_models(catalog, [listed("gpt-6.2-sol"), listed("gpt-6.2-sol-pro"), listed("gpt-6-luna")]);
  const by_id = new Map(models.map((model) => [model.id, model]));
  assert.deepEqual(by_id.get("openai/gpt-6.2-sol")?.pro, sol.pro);
  assert.equal(by_id.get("openai/gpt-6-luna")?.pro, undefined);
  assert.deepEqual(plan_ids, ["openai/gpt-6.2-sol", "openai/gpt-6.2-sol-pro", "openai/gpt-6-luna"]);
  assert.deepEqual(pro_locked, ["openai/gpt-6-luna"]);
});

test("the account context window caps the context length and never raises it", () => {
  const { models } = plan_models(catalog, [listed("gpt-6.2-sol", 272000), listed("gpt-6-luna", 2000000), listed("gpt-6-astra")]);
  const by_id = new Map(models.map((model) => [model.id, model.context_length]));
  assert.equal(by_id.get("openai/gpt-6.2-sol"), 272000);
  assert.equal(by_id.get("openai/gpt-6-luna"), 1050000);
  assert.equal(by_id.get("openai/gpt-6-astra"), 1050000);
});

test("an unknown account list runs every plan entry on the plan and locks every Pro", () => {
  const { models, plan_ids, pro_locked, side_pool } = plan_models(catalog, null);
  assert.deepEqual(plan_ids, ["openai/gpt-6.2-sol", "openai/gpt-6-luna", "openai/gpt-6-astra"]);
  const plan = models.filter((model) => plan_ids.includes(model.id));
  assert.deepEqual(ids(plan), ["openai/gpt-6.2-sol", "openai/gpt-6-luna", "openai/gpt-6-astra"]);
  assert.ok(plan.every((model) => model.tiers === catalog.find((entry) => entry.id === model.id)?.tiers && model.context_length === 1050000));
  assert.ok(plan.every((model) => model.pro === undefined));
  assert.deepEqual(pro_locked, ["openai/gpt-6.2-sol", "openai/gpt-6-luna"]);
  assert.deepEqual(ids(side_pool), ["openai/gpt-6.2-sol", "openai/gpt-6-luna", "openai/gpt-6-astra"]);
});

test("an account list that matches no catalog entry runs nothing on the plan and keeps every entry as it is", () => {
  for (const account of [[listed("gpt-9-unknown"), listed("gpt-oss-120b")], []]) {
    const { models, plan_ids, side_pool } = plan_models(catalog, account);
    assert.deepEqual(plan_ids, []);
    assert.equal(models.length, catalog.length);
    models.forEach((model, index) => assert.equal(model, catalog[index]));
    assert.deepEqual(ids(side_pool), ["openai/gpt-6.2-sol", "openai/gpt-6-luna", "openai/gpt-6-astra"]);
  }
});

test("models keep every catalog entry in catalog order and leave entries off the plan untouched", () => {
  const { models, side_pool } = plan_models(catalog, [listed("gpt-6-luna")]);
  assert.deepEqual(ids(models), ids(catalog));
  assert.equal(models[0], deepseek);
  assert.equal(models[1], sol);
  assert.ok(models[1]?.tiers && models[1].pro);
  assert.equal(models[4], oss);
  assert.deepEqual(models[2], without_pro(luna));
  assert.deepEqual(models[2]?.tiers, luna.tiers);
  assert.equal(side_pool[0], models[2]);
});

test("gpt-oss-120b on Cerebras never runs on the plan, even when the account lists its slug", () => {
  for (const account of [null, [], [listed("gpt-oss-120b")], [listed("gpt-oss-120b"), listed("gpt-6-luna")]]) {
    const { models, plan_ids } = plan_models(catalog, account);
    assert.ok(!plan_ids.includes("openai/gpt-oss-120b"));
    assert.equal(models.find((model) => model.id === "openai/gpt-oss-120b"), oss);
  }
});

test("unlisted slugs are the account models without a plan entry in the catalog", () => {
  assert.deepEqual(unlisted_slugs(catalog, [listed("gpt-6-luna"), listed("gpt-9-unknown"), listed("gpt-oss-120b"), listed("gpt-6.2-sol-pro")]), ["gpt-9-unknown", "gpt-oss-120b"]);
  assert.deepEqual(unlisted_slugs(catalog, [listed("gpt-6-luna")]), []);
  assert.deepEqual(unlisted_slugs(catalog, null), []);
});

test("the configured side model is used when the account lists it or the list is unknown", () => {
  const { side_pool } = plan_models(catalog, null);
  assert.deepEqual(pick_plan_side("title", plan_side, side_pool, null), { model_id: "openai/gpt-6-luna", effort: "none" });
  const account = [listed("gpt-6.2-sol"), listed("gpt-6-luna")];
  assert.deepEqual(pick_plan_side("overseer", plan_side, plan_models(catalog, account).side_pool, account), { model_id: "openai/gpt-6-luna", effort: "low" });
});

test("a side model the account does not list falls back to the first offered model at its lowest effort", () => {
  const account = [listed("gpt-6-astra"), listed("gpt-6.2-sol")];
  const { side_pool } = plan_models(catalog, account);
  for (const role of ["title", "overseer", "git_text"] as const) {
    assert.deepEqual(pick_plan_side(role, plan_side, side_pool, account), { model_id: "openai/gpt-6-astra", effort: "low" }, role);
  }
});

test("the vision side model falls back to the first offered model that takes images", () => {
  const account = [listed("gpt-6-astra"), listed("gpt-6.2-sol")];
  const { side_pool } = plan_models(catalog, account);
  assert.deepEqual(pick_plan_side("vision", plan_side, side_pool, account), { model_id: "openai/gpt-6.2-sol", effort: "low" });
  const text_only = [entry("openai/gpt-a", { vision: false }), entry("openai/gpt-b", { vision: false })];
  assert.deepEqual(pick_plan_side("vision", plan_side, text_only, [listed("gpt-a")]), { model_id: "openai/gpt-a", effort: "low" });
});

test("the fallback effort is the lowest effort that is not major", () => {
  const offered = [entry("openai/gpt-a", { efforts: ["minimal", "low", "major"], default_effort: "low" })];
  assert.equal(pick_plan_side("title", plan_side, offered, [listed("gpt-a")]).effort, "minimal");
  const plain = [entry("openai/gpt-b", { efforts: [], default_effort: "" })];
  assert.equal(pick_plan_side("title", plan_side, plain, [listed("gpt-b")]).effort, "");
});

test("every plan side pick is a plan eligible catalog model, so the completion route by slug never meets a non-OpenAI route", () => {
  const accounts = [null, [], [listed("gpt-oss-120b")], [listed("gpt-oss-120b"), listed("gpt-6-astra")], [listed("gpt-6.2-sol")], [listed("gpt-6-luna")]];
  for (const account of accounts) {
    const { side_pool } = plan_models(catalog, account);
    for (const role of ["title", "overseer", "vision", "git_text"] as const) {
      const pick = pick_plan_side(role, plan_side, side_pool, account);
      const picked = catalog.find((model) => model.id === pick.model_id);
      assert.ok(picked && plan_eligible(picked), `${role} with ${JSON.stringify(account)} picked ${pick.model_id}`);
      assert.notEqual(plan_slug(pick.model_id), null);
    }
  }
});
