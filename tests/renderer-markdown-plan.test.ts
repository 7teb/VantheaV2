import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Plugin } from "esbuild";
import { bundle, install_dom, quiet_vx, stub_components, FakeElement } from "./dom-kit.ts";
import { split_blocks } from "../src/components/markdown-blocks.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

const runtime: any = { busy: true, sends: [], finish_calls: 0, recording: null, end: () => {} };
let client: any;
let root: any;
let container: FakeElement;
let restore = () => {};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const nothing = (name: string) => `export const ${name}=()=>null;`;
const stubs: Record<string, string> = {
  ComposerMedia: nothing("ComposerMedia"), DraftChips: nothing("DraftChips"), ModelPicker: nothing("ModelPicker"), ModePicker: nothing("ModePicker"), PlusMenu: nothing("PlusMenu"), WorktreeChip: nothing("WorktreeChip"), DictationButton: nothing("DictationButton"),
  SlashMenu: `${nothing("SlashMenu")} export const slash_option_id=()=>"option";`,
  Markdown: 'export const Markdown=()=>null;',
  QuestionForm: 'import {createElement} from "react";export const QuestionForm=(props)=>{globalThis.composer_runtime.question=props;return createElement("button",{},"Plan question")}',
};
const modules: Record<string, string> = {
  "dictation.ts": 'import {create_store} from "./src/state/create-store.ts"; export const dictation_store=create_store(null); export const cancel_dictation=()=>dictation_store.set(null); export const finish_dictation=async()=>{const r=globalThis.composer_runtime; r.finish_calls++;dictation_store.set({draft_key:"c1",phase:"transcribing"});try{return await r.recording;}finally{dictation_store.set(null)}};',
  "composer-hooks.ts": 'export const use_chat_busy=()=>globalThis.composer_runtime.busy; export const use_model_context=()=>({model:{id:"m",vision:true},setting:undefined}); export const use_model_choice=()=>({model:"m",pro:false});export const use_shown_context=()=>({usage:null});',
  "use-command-context.ts": 'export const use_command_context=(input)=>input;',
  "use-slash-menu.ts": 'export const use_slash_menu=()=>({open:false,items:[],active:0,on_key_down:()=>false,track:()=>{}});',
  "model-choice.ts": 'export const choice_for=()=>({model:"m",effort:"",pro:false});export const set_choice=async()=>{};export const take_new_chat_choice=choice_for;',
  "chat-busy.ts": 'export const chat_busy=()=>globalThis.composer_runtime.busy;',
  "chat-view.ts": 'import {create_store} from "./src/state/create-store.ts";export const chat_view_store=create_store({entries:{}});export const compact_chat_now=async()=>"done";export const on_steer_taken=()=>()=>{};export const on_turn_end=(handler)=>{globalThis.composer_runtime.end=handler;return()=>{}};',
  "command-registry.ts": 'export const start_typed_review=()=>false;',
};
const plugin: Plugin = { name: "composer-fixtures", setup(builder) {
  builder.onResolve({ filter: /\.ts$/ }, (args) => {
    if (args.importer.replaceAll("\\", "/").includes("/i18n/")) return;
    const name = args.path.split("/").at(-1) ?? "";
    if (name in modules) return { path: name, namespace: "composer" };
  });
  builder.onLoad({ filter: /.*/, namespace: "composer" }, (args) => ({ contents: modules[args.path], loader: "js", resolveDir: process.cwd() }));
} };
const props = (element: FakeElement): any => (element as any)[Object.keys(element).find((name) => name.startsWith("__reactProps$")) ?? ""];

before(async () => {
  (globalThis as any).composer_runtime = runtime;
  const dom = install_dom({ ...quiet_vx, invoke: async (name, ...args) => { if (name === "turn:send") { runtime.sends.push(args[0]);return runtime.send(); } } });
  restore = dom.restore;
  client = await bundle([
    'export {createElement} from "react"; export {flushSync} from "react-dom";export {createRoot} from "react-dom/client";',
    'export {Composer} from "./src/features/composer/Composer.tsx";export {VirtualRows} from "./src/components/VirtualRows.tsx";export {PlanCard} from "./src/features/chat/PlanCard.tsx";',
    'export {composer_store,set_draft_text,queue_draft,submit,init_composer} from "./src/state/composer.ts";',
    'export {dictation_store} from "./src/state/dictation.ts";export {empty_composer,queue_of} from "./src/state/chat-drafts.ts";export {settings_store} from "./src/state/settings.ts";',
  ], [plugin, stub_components("Composer.tsx", stubs), stub_components("PlanCard.tsx", stubs)]);
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
  client.init_composer();
});
beforeEach(() => {
  client.flushSync(() => root.render(null));
  runtime.busy = true;runtime.sends = [];runtime.finish_calls = 0;runtime.send = async () => undefined;runtime.question = null;
  client.composer_store.set(client.empty_composer);
  client.settings_store.set({ mode: "auto" });
  client.dictation_store.set(null);
});
after(() => { root?.unmount();restore();delete (globalThis as any).composer_runtime; });

test("loose ordered lists remain one list with sequential browser numbering", () => {
  const source = "1. First\n\n1. Second\n\n1. Third";
  const html = split_blocks(source).map((part) => renderToStaticMarkup(createElement(ReactMarkdown, { children: part }))).join("");
  assert.equal((html.match(/<ol/g) ?? []).length, 1, html);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
});

test("moving the list on a same-size parent rerender refreshes the visible row window", () => {
  const host = container.ownerDocument!.createElement("div") as any;
  host.scrollTop = 500;host.clientHeight = 100;
  let top = -500;
  const original = FakeElement.prototype.getBoundingClientRect;
  FakeElement.prototype.getBoundingClientRect = function() { return { ...original.call(this), top: this.className === "virtual" ? top : 0 }; };
  try {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const render = () => client.createElement(client.VirtualRows, { items, row_height: 10, scroller: host, className: "virtual", render: (item: number) => client.createElement("span", { key: item }, `row${item},`) });
    client.flushSync(() => root.render(render()));
    assert.ok(container.textContent.startsWith("row42,"), container.textContent);
    top = -100;
    client.flushSync(() => root.render(render()));
    assert.ok(container.textContent.startsWith("row2,"), container.textContent);
  } finally { FakeElement.prototype.getBoundingClientRect = original; }
});

test("failed plan feedback leaves the accept question available for retry", async () => {
  runtime.busy = false;runtime.send = async () => { const error = new Error("send failed");error.stack = "send failed fixture";throw error; };
  client.flushSync(() => root.render(client.createElement(client.PlanCard, { chat_id: "c1", message_id: "m1", text: "plan", can_accept: true, accepted: false })));
  const question = runtime.question;
  let answer: any;
  client.flushSync(() => { answer = question.on_other("change step two"); });
  await answer;await settle();
  assert.ok(container.textContent.includes("Plan question"), container.textContent);
  assert.equal((await answer).ok, false);
});

test("Tab finishes active dictation before queuing typed and spoken text together", async () => {
  let finish: (text: string) => void = () => {};
  runtime.recording = new Promise<string>((resolve) => { finish = resolve; });
  client.set_draft_text("c1", "typed");client.dictation_store.set({ draft_key: "c1", phase: "recording" });
  client.flushSync(() => root.render(client.createElement(client.Composer, { chat_id: "c1", project_path: "", draft_key: "c1", placement: "docked" })));
  const area = container.matching((element) => element.tagName === "TEXTAREA")[0];
  client.flushSync(() => props(area).onKeyDown({ key: "Tab", currentTarget: area, preventDefault() {}, nativeEvent: {} }));
  assert.equal(runtime.finish_calls, 1);
  assert.equal(client.queue_of(client.composer_store.get(), "c1").length, 0);
  finish("spoken");await settle();await settle();
  assert.equal(client.queue_of(client.composer_store.get(), "c1")[0]?.text, "typed spoken");
  assert.equal(client.dictation_store.get(), null);
});

test("a turn ending before its send RPC resolves cannot strand the next queued message", async () => {
  runtime.busy = false;
  let resolve = () => {};
  runtime.send = () => new Promise<void>((accept) => { resolve = accept; });
  client.set_draft_text("c1", "first");
  const sending = client.submit("c1", "");
  client.set_draft_text("c1", "second");await client.queue_draft("c1");
  assert.equal(client.queue_of(client.composer_store.get(), "c1").length, 1);
  runtime.end("c1", "done", "m1");
  runtime.send = async () => undefined;
  resolve();await sending;await settle();
  assert.equal(runtime.sends.length, 2);
  assert.equal(client.queue_of(client.composer_store.get(), "c1").length, 0);
});

test("loose list boundaries match actual Markdown parsing across marker types and nested content", () => {
  const render = (source: string) => renderToStaticMarkup(createElement(ReactMarkdown, { children: source })).replace(/>\s+</g, "><");
  for (const source of [
    "1. First\n\n2. Second\n\n3. Third\n\nOutside",
    "Before\n1. First\n\n1. Second",
    "3) First\n\n1) Second",
    "1. First\n\n1) New list",
    "- First\n\n- Second",
    "- First\n\n* New list",
    "1. First\n\n   paragraph\n\n1. Second",
    "1. First\r\n\r\n1. Second",
  ]) assert.equal(split_blocks(source).map(render).join(""), render(source), source);
});

test("plan feedback succeeds only after the send succeeds and never duplicates its retry text into the composer", async () => {
  runtime.busy = false;
  client.set_draft_text("c1", "existing draft");
  let reject: (error: Error) => void = () => {};
  runtime.send = () => new Promise<void>((resolve, fail) => { void resolve;reject = fail; });
  client.flushSync(() => root.render(client.createElement(client.PlanCard, { chat_id: "c1", message_id: "m1", text: "plan", can_accept: true, accepted: false })));
  const pending = runtime.question.on_other("feedback");
  assert.ok(container.textContent.includes("Plan question"));
  const error = new Error("retry send");error.stack = "retry fixture";reject(error);
  assert.equal((await pending).ok, false);await settle();
  assert.equal(client.composer_store.get().drafts.c1.text, "existing draft");
  assert.ok(container.textContent.includes("Plan question"));
  runtime.send = async () => undefined;
  assert.equal((await runtime.question.on_other("feedback")).ok, true);await settle();
  assert.equal(container.textContent.includes("Plan question"), false);
  assert.equal(client.composer_store.get().drafts.c1.text, "existing draft");
});

test("dismissing the plan question without feedback performs no send", async () => {
  runtime.busy = false;
  client.flushSync(() => root.render(client.createElement(client.PlanCard, { chat_id: "c1", message_id: "m1", text: "plan", can_accept: true, accepted: false })));
  assert.equal((await runtime.question.on_other("")).ok, true);await settle();
  assert.equal(runtime.sends.length, 0);
  assert.equal(container.textContent.includes("Plan question"), false);
});

test("dictation failure and switching drafts preserve text without queuing a partial recording", async () => {
  for (const switched of [false, true]) {
    runtime.busy = true;
    client.composer_store.set(client.empty_composer);
    let finish: (text: string | null) => void = () => {};
    runtime.recording = new Promise<string | null>((resolve) => { finish = resolve; });
    client.set_draft_text("c1", "typed");client.dictation_store.set({ draft_key: "c1", phase: "recording" });
    const render = (id: string) => client.createElement(client.Composer, { chat_id: id, project_path: "", draft_key: id, placement: "docked" });
    client.flushSync(() => root.render(render("c1")));
    const area = container.matching((element) => element.tagName === "TEXTAREA")[0];
    client.flushSync(() => props(area).onKeyDown({ key: "Tab", currentTarget: area, preventDefault() {}, nativeEvent: {} }));
    if (switched) client.flushSync(() => root.render(render("c2")));
    finish(switched ? "spoken" : null);await settle();await settle();
    assert.equal(client.composer_store.get().drafts.c1.text, switched ? "typed spoken" : "typed");
    assert.equal(client.queue_of(client.composer_store.get(), "c1").length, 0);
  }
});

test("an ordinary send response does not drain before end and a failed send does not send the queued successor", async () => {
  for (const failed of [false, true]) {
    runtime.busy = false;runtime.sends = [];client.composer_store.set(client.empty_composer);
    let resolve: () => void = () => {};
    let reject: (error: Error) => void = () => {};
    runtime.send = () => new Promise<void>((accept, fail) => { resolve = accept;reject = fail; });
    client.set_draft_text("c1", "first");const sending = client.submit("c1", "");
    client.set_draft_text("c1", "second");await client.queue_draft("c1");
    if (failed) runtime.end("c1", "done", "m1");
    runtime.send = async () => undefined;
    if (failed) { const error = new Error("send failed");error.stack = "failed send fixture";reject(error); } else resolve();
    await sending;await settle();
    assert.equal(runtime.sends.length, 1);
    assert.equal(client.queue_of(client.composer_store.get(), "c1").length, 1);
    if (!failed) { runtime.end("c1", "done", "m1");await settle();assert.equal(runtime.sends.length, 2); }
    else assert.equal(client.composer_store.get().drafts.c1.text, "first");
  }
});
