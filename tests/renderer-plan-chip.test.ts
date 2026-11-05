import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { bundle, install_dom, quiet_vx, stub_components, type FakeElement } from "./dom-kit.ts";

const nothing = (name: string) => `export const ${name} = () => null;`;

const stubs: Record<string, string> = {
  ComposerMedia: nothing("ComposerMedia"),
  ContextRing: nothing("ContextRing"),
  DraftChips: nothing("DraftChips"),
  ModelPicker: nothing("ModelPicker"),
  ModePicker: nothing("ModePicker"),
  PlusMenu: nothing("PlusMenu"),
  SlashMenu: `${nothing("SlashMenu")} export const slash_option_id = (base, id) => base + "-" + id;`,
};

const key = "new:D:\\p";
let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const plan_chips = () => container.matching((element) => element.tagName === "BUTTON" && element.getAttribute("data-kind") === "plan");

const plan_command = () => client.composer_commands.find((command: { id: string }) => command.id === "plan");

before(async () => {
  const dom = install_dom(quiet_vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { Composer } from "./src/features/composer/Composer.tsx";',
      'export { composer_commands } from "./src/features/composer/command-registry.ts";',
      'export { composer_store, toggle_plan } from "./src/state/composer.ts";',
      'export { draft_of } from "./src/state/chat-drafts.ts";',
    ],
    [stub_components("Composer.tsx", stubs)],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
  client.flushSync(() => root.render(client.createElement(client.Composer, { chat_id: null, project_path: "D:\\p", draft_key: key, placement: "hero" })));
});

after(() => {
  root?.unmount();
  restore();
});

test("the composer bar has no plan chip while plan mode is off", () => {
  assert.equal(client.draft_of(client.composer_store.get(), key).plan, false);
  assert.equal(plan_chips().length, 0);
});

test("plan mode from the plus menu or /plan shows an active plan chip, and turning it off hides the chip again", () => {
  client.flushSync(() => client.toggle_plan(key));
  const chips = plan_chips();
  assert.equal(chips.length, 1);
  assert.equal(chips[0].getAttribute("aria-pressed"), "true");
  assert.equal(chips[0].getAttribute("data-active"), "true");
  client.flushSync(() => plan_command().run({ draft_key: key }));
  assert.equal(client.draft_of(client.composer_store.get(), key).plan, false);
  assert.equal(plan_chips().length, 0);
});
