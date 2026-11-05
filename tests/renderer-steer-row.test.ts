import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { SteerStep } from "../shared/chat.ts";
import { bundle, install_dom, quiet_vx, stub_components, type FakeElement } from "./dom-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const render = (element: unknown) => client.flushSync(() => root.render(element));

const with_class = (name: string) => container.matching((element) => element.className.split(" ").includes(name));

before(async () => {
  const dom = install_dom(quiet_vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { SteerRow } from "./src/features/chat/StepRows.tsx";',
    ],
    [stub_components("StepRows.tsx", {})],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

test("a steer from the user shows as a user bubble with the text and no arrow", () => {
  const step: SteerStep = { id: "steer:7", round: 2, kind: "steer", text: "use the parser in src/next instead", steer_id: "s1", at: 1000 };
  render(client.createElement(client.SteerRow, { step }));
  const [bubble] = with_class("user-bubble");
  assert.equal(bubble?.textContent, "use the parser in src/next instead");
  assert.equal(with_class("user-message").length, 1);
  assert.equal(container.matching((element) => element.tagName?.toLowerCase() === "svg").length, 0);
});

test("a steer with only attachments shows no empty bubble", () => {
  const step: SteerStep = { id: "steer:8", round: 3, kind: "steer", text: "", attachments: [] };
  render(client.createElement(client.SteerRow, { step }));
  assert.equal(with_class("user-bubble").length, 0);
});
