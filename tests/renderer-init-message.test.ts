import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { UserMessage } from "../shared/chat.ts";
import { git_init_request_text } from "../electron/turn/git-init-request.ts";
import { init_request_text } from "../electron/turn/init-request.ts";
import { review_request_text } from "../electron/turn/review-request.ts";
import { bundle, install_dom, quiet_vx, stub_components, type FakeElement } from "./dom-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const message = (origin: UserMessage["origin"], text: string): UserMessage => ({ id: `m_${origin}`, role: "user", text, attachments: [], origin, created_at: "2026-10-15T10:00:00.000Z" });

const show = (data: UserMessage) => client.flushSync(() => root.render(client.createElement(client.UserMessage, { chat_id: "c1", message: data, busy: false })));

const with_class = (name: string) => container.matching((element) => element.className.split(" ").includes(name));

before(async () => {
  const dom = install_dom(quiet_vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { UserMessage } from "./src/features/chat/UserMessage.tsx";',
    ],
    [
      stub_components("UserMessage.tsx", {
        MarkdownCopy: "export const CopyButton = () => null;",
        UserEditor: "export const UserEditor = () => null;",
        UserAttachments: "export const UserAttachments = () => null;",
      }),
    ],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

test("an Initialize request shows as the user's /init bubble, not as the full request text or a chip", () => {
  show(message("init", init_request_text));
  assert.deepEqual(with_class("user-bubble").map((element) => element.textContent), ["/init"]);
  assert.equal(with_class("origin-note").length, 0);
  assert.equal(container.matching((element) => element.getAttribute("aria-label") === "Edit").length, 0);
});

test("a Create GitHub repository request shows as the user's /gitinit bubble", () => {
  show(message("git_init", git_init_request_text));
  assert.deepEqual(with_class("user-bubble").map((element) => element.textContent), ["/gitinit"]);
  assert.equal(with_class("origin-note").length, 0);
  assert.equal(container.matching((element) => element.getAttribute("aria-label") === "Edit").length, 0);
});

test("a normal user message keeps its own text and its edit button", () => {
  show(message("user", "fix the parser"));
  assert.deepEqual(with_class("user-bubble").map((element) => element.textContent), ["fix the parser"]);
  assert.equal(container.matching((element) => element.getAttribute("aria-label") === "Edit").length, 1);
});

const reviewer_model = { id: "m", label: "M", provider: "p", provider_order: [], efforts: [], default_effort: "", vision: false, context_length: 1_000_000, max_output: 4096, reasoning_passback: false };

test("a review request shows as /review, with the pull request number when it has one", () => {
  show(message("review", review_request_text(null, reviewer_model)));
  assert.deepEqual(with_class("user-bubble").map((element) => element.textContent), ["/review"]);
  assert.equal(with_class("origin-note").length, 0);
  assert.equal(container.matching((element) => element.getAttribute("aria-label") === "Edit").length, 0);
  show({ ...message("review", review_request_text("42", reviewer_model)), command_arg: "42" });
  assert.deepEqual(with_class("user-bubble").map((element) => element.textContent), ["/review 42"]);
  assert.equal(container.matching((element) => element.getAttribute("aria-label") === "Edit").length, 0);
});
