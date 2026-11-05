import assert from "node:assert/strict";
import { test } from "node:test";
import type { Settings } from "../shared/settings.ts";
import { push_layer, close_top_layer, layer_count } from "../src/components/layers.ts";
import { create_store } from "../src/state/create-store.ts";
import { apply_settings_patch } from "../src/state/settings-patch.ts";

test("create_store notifies on change and skips identical values", () => {
  const store = create_store({ count: 0 });
  let calls = 0;
  const stop = store.subscribe(() => {
    calls += 1;
  });
  store.update((state) => ({ count: state.count + 1 }));
  assert.equal(store.get().count, 1);
  assert.equal(calls, 1);
  store.set(store.get());
  assert.equal(calls, 1);
  stop();
  store.set({ count: 5 });
  assert.equal(calls, 1);
  assert.equal(store.get().count, 5);
});

test("a listener can unsubscribe another listener mid-notification", () => {
  const store = create_store(0);
  const order: string[] = [];
  let stop_b: () => void = () => undefined;
  store.subscribe(() => {
    order.push("a");
    stop_b();
  });
  stop_b = store.subscribe(() => order.push("b"));
  store.set(1);
  store.set(2);
  assert.deepEqual(order, ["a", "b", "a"]);
});

const settings = (): Settings => ({
  language: "en",
  model: "m",
  effort: "high",
  mode: "ask",
  projects: [{ path: "D:\\a", name: "", pinned: false, folder_id: "" }],
  personality: "pragmatic",
  custom_instructions: "",
  notification_sound: true,
  memory: { enabled: true, exclude_tool_chats: false },
  web_search: { enabled: false, max_results: 5, topic: "general" },
  image_gen: { enabled: false, model: "i", quality: "auto" },
  mcp_servers: {},
  mcp_tools: {},
  skills: { disabled: [] },
  model_context: {},
  hooks: { global: [], projects: {} },
});

test("settings patches merge objects one level and replace arrays and scalars", () => {
  const current = settings();
  const next = apply_settings_patch(current, {
    language: "de",
    memory: { enabled: false },
    projects: [],
    skills: { disabled: ["x"] },
  });
  assert.equal(next.language, "de");
  assert.deepEqual(next.memory, { enabled: false, exclude_tool_chats: false });
  assert.deepEqual(next.projects, []);
  assert.deepEqual(next.skills, { disabled: ["x"] });
  assert.equal(next.web_search, current.web_search);
  assert.equal(current.language, "en");
});

test("the layer stack closes the most recently opened layer first", () => {
  const closed: string[] = [];
  const remove_first = push_layer(() => closed.push("first"));
  const remove_second = push_layer(() => closed.push("second"));
  assert.equal(layer_count(), 2);
  assert.equal(close_top_layer(), true);
  assert.deepEqual(closed, ["second"]);
  remove_second();
  assert.equal(close_top_layer(), true);
  assert.deepEqual(closed, ["second", "first"]);
  remove_first();
  assert.equal(close_top_layer(), false);
  assert.equal(layer_count(), 0);
});
