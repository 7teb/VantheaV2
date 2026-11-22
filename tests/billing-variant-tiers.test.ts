import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Message } from "../shared/chat.ts";
import type { AccountModel } from "../shared/chatgpt.ts";
import { find_model, message_choice, with_choice, type ModelCatalog, type ModelEntry } from "../shared/models.ts";
import { find_agent_model, init_agents } from "../electron/agents/runner.ts";
import { plan_models } from "../electron/billing/offered.ts";
import { parse_catalog } from "../electron/model/catalog.ts";
import { read_catalog_source } from "../electron/model/catalog-source.ts";
import { set_key_source } from "../electron/model/key.ts";
import { plan_responses_url } from "../electron/model/plan/send.ts";
import { stream_model } from "../electron/model/provider.ts";
import type { Transport } from "../electron/model/transport.ts";
import type { RoundRequest } from "../electron/model/types.ts";
import { body_of, chunk, write_spec } from "./model-stream-harness.ts";
import { answer_frames, fake_source, with_source } from "./plan-harness.ts";

set_key_source(() => "sk-or-test-key");

const catalog = parse_catalog(await read_catalog_source(fileURLToPath(new URL("../config/models", import.meta.url))));

const listed = (...slugs: string[]): AccountModel[] => slugs.map((slug) => ({ slug, display_name: slug, context_window: null }));

const plan_catalog = (account: readonly AccountModel[]): ModelCatalog => {
  const { models, plan_ids, pro_locked } = plan_models(catalog.models, account);
  return { ...catalog, models, plan_ids, pro_locked };
};

const entry_of = (models: readonly ModelEntry[], id: string): ModelEntry => {
  const entry = models.find((model) => model.id === id);
  assert.ok(entry, id);
  return entry;
};

type Seen = { url: string; body: string };

const capture = () => {
  const seen: Seen[] = [];
  const transport: Partial<Transport> = {
    fetch: async (url, init) => {
      seen.push({ url, body: String(init.body) });
      if (url === plan_responses_url) {
        return new Response(body_of(answer_frames("plan answer")), { status: 200 });
      }
      return new Response(body_of([{ data: chunk({ content: "hello" }) + chunk({}, "stop") + "data: [DONE]\n\n" }]), { status: 200 });
    },
    sleep: async () => {},
    random: () => 0,
    first_byte_ms: 200,
    idle_ms: 200,
  };
  return { seen, transport };
};

const callbacks = { on_text: () => {}, on_reasoning: () => {}, on_tool_draft: () => {}, on_retry: () => {} };

const round = (model: ModelEntry): RoundRequest => ({
  model,
  effort: "high",
  messages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "hi" },
  ],
  tools: [write_spec],
  max_tokens: 32000,
});

const routed_seen = async (model: ModelEntry) => {
  const routed = capture();
  await stream_model(round(model), callbacks, new AbortController().signal, routed.transport);
  return routed.seen;
};

const assistant = (model: string) => ({ id: `a-${model}`, role: "assistant", model, effort: "high", steps: [] }) as unknown as Message;

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-chatgpt-variant-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("plan billing with the base model listed and Pro not: Pro is locked and a stored Pro choice runs the base model on the plan", async () => {
  const account = listed("gpt-6.2-sol");
  const plan = plan_catalog(account);
  const plan_sol = entry_of(plan.models, "openai/gpt-6.2-sol");
  const api_sol = entry_of(catalog.models, "openai/gpt-6.2-sol");
  assert.equal(plan_sol.pro, undefined);
  assert.ok(plan.pro_locked?.includes("openai/gpt-6.2-sol"));
  const pro_fast = with_choice(plan_sol, { pro: true, tier: "fast" }, plan.plan_ids);
  assert.deepEqual([pro_fast.id, pro_fast.label, pro_fast.provider_order, pro_fast.tiers], ["openai/gpt-6.2-sol", "GPT 6.2 Sol", ["openai"], undefined]);
  const api_pro_fast = with_choice(api_sol, { pro: true, tier: "fast" });
  assert.deepEqual([api_pro_fast.id, api_pro_fast.label, api_pro_fast.provider_order], ["openai/gpt-6.2-sol-pro", "GPT 6.2 Sol Pro Fast", ["openai/fast"]]);
  await with_source(fake_source("chatgpt", ["plan-token-1"], account).source, async () => {
    assert.deepEqual(
      (await routed_seen(pro_fast)).map((seen) => seen.url),
      [plan_responses_url],
    );
  });
});

test("an openai :floor id of a plan model resolves in plan billing for sub-agents, stored messages and labels, its locked Pro does not", async () => {
  const account = listed("gpt-6.1-sol");
  const plan = plan_catalog(account);
  await init_agents({
    dir: path.join(root, "agents"),
    stream: async () => {
      throw new Error("unexpected agent run");
    },
    resolve_tools: () => [],
    side_model: async () => "",
    review_call: async () => {
      throw new Error("unexpected review");
    },
    models: async () => plan.models,
  });
  const flex = await find_agent_model("openai/gpt-6.1-sol:floor");
  assert.deepEqual([flex.id, flex.provider_order], ["openai/gpt-6.1-sol", ["openai/flex", "openai"]]);
  await assert.rejects(find_agent_model("openai/gpt-6.1-sol-pro:floor"));
  await assert.rejects(find_agent_model("openai/gpt-6.1-sol-pro"));
  assert.deepEqual(message_choice(plan, [assistant("openai/gpt-6.1-sol:floor")]), { model: "openai/gpt-6.1-sol", effort: "high", pro: false, tier: "flex" });
  const plan_label = find_model(plan, "openai/gpt-6.1-sol:floor");
  assert.deepEqual([plan_label?.label, plan_label?.tiers], ["GPT 6.1 Sol", undefined]);
  assert.equal(find_model(plan, "openai/gpt-6.1-sol-pro:floor"), null);
  assert.equal(find_model(catalog, "openai/gpt-6.1-sol:floor")?.label, "GPT 6.1 Sol Flex");
  assert.equal(find_model(catalog, "openai/gpt-6.1-sol-pro:floor")?.label, "GPT 6.1 Sol Pro Flex");
  await with_source(fake_source("chatgpt", ["plan-token-1"], account).source, async () => {
    assert.deepEqual(
      (await routed_seen(flex)).map((seen) => seen.url),
      [plan_responses_url],
    );
  });
});
