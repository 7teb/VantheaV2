import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { bundle, install_dom, stub_components, type FakeElement } from "./dom-kit.ts";

let client: any;
let root: any;
let container: FakeElement;
let restore = () => {};
let body = "old skill body";
let skill = { slug: "sample", name: "Sample", description: "Skill", enabled: true, builtin: false, group: "", files: [], source: "", error: "" };
const calls: { name: string; args: any[] }[] = [];
const searches = new Map<string, { resolve: (hits: unknown[]) => void; reject: (error: Error) => void }>();
let hold_body: ((text: string) => void) | null = null;
let body_pending = false;
let body_error = false;
let write_result: any = { kind: "text", title: "generated title", body: "generated body", base: "main", push_first: null };
let create_result: any = { kind: "done", url: "https://example.test/pr/1", number: 1 };
const invoke = async (name: string, ...args: any[]) => {
  calls.push({ name, args });
  if (name === "skills:list") return [{ ...skill }];
  if (name === "skills:body") {
    if (body_error) throw new Error("body read failed");
    if (body_pending) return new Promise<string>((resolve) => { hold_body = resolve; });
    return body;
  }
  if (name === "chats:search") return new Promise((resolve, reject) => searches.set(args[0], { resolve, reject }));
  if (name === "github:write_pr") return write_result;
  if (name === "github:create_pr") return create_result;
  return undefined;
};
const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); client.flushSync(() => {}); };
const matching = (class_name: string) => container.matching((node) => node.className.split(" ").includes(class_name));
const props = (node: FakeElement): any => (node as any)[Object.keys(node).find((key) => key.startsWith("__reactProps$"))!];
const click = (node: FakeElement) => client.flushSync(() => props(node).onClick());
const show = (component: any) => client.flushSync(() => root.render(client.createElement(component)));
const hit = (id: string) => ({ chat_id: id, title: id, project_path: "D:/project", snippet: id, updated_at: new Date().toISOString() });
const search_type = (value: string) => client.flushSync(() => props(matching("search-field")[0].matching((node) => node.nodeName === "INPUT")[0]).onChange({ target: { value } }));
const enter = () => client.flushSync(() => props(matching("search-panel")[0]).onKeyDown({ key: "Enter", preventDefault() {} }));
const wait_search = async (query: string) => {
  for (let index = 0; index < 100 && !searches.has(query); index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(searches.has(query), query);
};
const view_button = () => container.matching((node) => node.nodeName === "BUTTON" && ["Show SKILL.md", "Hide SKILL.md"].includes(props(node)?.["aria-label"]))[0];
const pr_button = () => matching("pr-foot")[0].matching((node) => node.nodeName === "BUTTON").at(-1)!;
const pr_draft = (overrides: Record<string, unknown> = {}) => ({ open: true, branch: "feature", title: "", body: "", base: "main", push_first: null, writing: false, creating: false, issue: null, cli: { kind: "cli", cli: { state: "signed_out", version: null }, command: "gh auth login" }, ...overrides });

before(async () => {
  const dom = install_dom({ invoke, on: () => () => {}, send: () => {} });
  restore = dom.restore;
  client = await bundle([
    'export {createElement} from "react"; export {flushSync} from "react-dom"; export {createRoot} from "react-dom/client";',
    'export {PrComposer} from "./src/features/docks/files/git/PrComposer.tsx";',
    'export {SkillsPane} from "./src/features/settings/panes/SkillsPane.tsx";',
    'export {SearchOverlay} from "./src/features/shell/SearchOverlay.tsx";',
    'export {skills_store,load_skills} from "./src/state/extensions.ts";',
    'export {git_pr_store,pr_of,open_pr,create_pr} from "./src/state/git-pr.ts";',
    'export {files_store} from "./src/state/files.ts"; export {git_store} from "./src/state/git.ts";',
    'export {github_store} from "./src/state/github.ts"; export {chats_store} from "./src/state/chats.ts";',
    'export {ui_store} from "./src/state/ui.ts";',
  ], [
    stub_components("SearchOverlay.tsx", { Dialog: 'export const Dialog=({open,children})=>open?children:null;' }),
  ]);
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});
after(() => { root?.unmount(); restore(); });
beforeEach(() => {
  client.flushSync(() => root.render(null));
  calls.length = 0;
  searches.clear();
  body = "old skill body";
  body_pending = false;
  body_error = false;
  hold_body = null;
  skill = { ...skill, name: "Sample" };
  write_result = { kind: "text", title: "generated title", body: "generated body", base: "main", push_first: null };
  create_result = { kind: "done", url: "https://example.test/pr/1", number: 1 };
  client.skills_store.set({ status: "ready", items: [{ ...skill }] });
  client.ui_store.set({ ...client.ui_store.get(), search_open: true, active_chat_id: null, project_path: "D:/project" });
  client.chats_store.set({ status: "ready", list: [] });
  client.files_store.set({ key: "fixture", views: { fixture: { scope: { chat_id: null, project_path: "D:/project" }, root: { status: "ready", root: { path: "D:/project", kind: "project", name: "project" } } } } });
  client.git_store.set({ views: { "D:/project": { kind: "repo", branch: { name: "feature" }, primary_remote: "origin" } }, ui: {}, readable: null });
  client.github_store.set({ views: {} });
  client.git_pr_store.set({ drafts: {} });
});

test("a CLI-blocked PR composer offers an actionable retry", async () => {
  client.git_pr_store.set({ drafts: { "D:/project": pr_draft() } });
  show(client.PrComposer);
  assert.equal(props(pr_button()).disabled, false);
  click(pr_button());
  await settle();
  assert.equal(calls.filter((call) => call.name === "github:write_pr").length, 1);
  assert.equal(client.pr_of(client.git_pr_store.get(), "D:/project").title, "generated title");
});

test("a successful skill reload refreshes an already open body", async () => {
  show(client.SkillsPane);
  await settle();
  click(view_button());
  await settle();
  assert.ok(container.textContent.includes("old skill body"));
  body = "new skill body";
  await client.load_skills();
  await settle();
  assert.ok(container.textContent.includes("new skill body"));
  assert.equal(container.textContent.includes("old skill body"), false);
});

test("a changed query hides old hits and Enter cannot open the old chat", async () => {
  show(client.SearchOverlay);
  search_type("first");
  await wait_search("first");
  searches.get("first")!.resolve([hit("old-chat")]);
  await settle();
  assert.equal(matching("search-hit").length, 1);
  search_type("second");
  assert.equal(matching("search-hit").length, 0);
  enter();
  assert.equal(client.ui_store.get().active_chat_id, null);
});

test("retrying creation preserves the edited title and body", async () => {
  const draft = pr_draft({ title: "hand-written title", body: "hand-written body", base: "release" });
  client.git_pr_store.set({ drafts: { "D:/project": draft } });
  show(client.PrComposer);
  click(pr_button());
  await settle();
  assert.deepEqual(calls.filter((call) => call.name.startsWith("github:")), [{ name: "github:create_pr", args: [{ chat_id: null, project_path: "D:/project" }, { title: draft.title, body: draft.body, base: draft.base }] }]);
  assert.equal(client.pr_of(client.git_pr_store.get(), "D:/project").open, false);
});

test("another CLI result stays retryable and keeps the existing PR text", async () => {
  const draft = pr_draft({ title: "keep title", body: "keep body" });
  create_result = draft.cli;
  client.git_pr_store.set({ drafts: { "D:/project": draft } });
  show(client.PrComposer);
  click(pr_button());
  await settle();
  assert.equal(props(pr_button()).disabled, false);
  assert.equal(client.pr_of(client.git_pr_store.get(), "D:/project").body, "keep body");
  create_result = { kind: "done", url: "https://example.test/pr/1", number: 1 };
  click(pr_button());
  await settle();
  assert.equal(calls.filter((call) => call.name === "github:create_pr").length, 2);
});

test("CLI recovery still respects a busy chat", () => {
  client.files_store.set({ ...client.files_store.get(), views: { fixture: { ...client.files_store.get().views.fixture, scope: { chat_id: "busy-chat", project_path: "D:/project" } } } });
  client.chats_store.set({ status: "ready", list: [{ id: "busy-chat", streaming: true }] });
  client.git_pr_store.set({ drafts: { "D:/project": pr_draft() } });
  show(client.PrComposer);
  assert.equal(props(pr_button()).disabled, true);
});

test("an old pending body cannot replace content from a newer reload", async () => {
  show(client.SkillsPane);
  await settle();
  body_pending = true;
  click(view_button());
  await settle();
  const old = hold_body;
  assert.ok(old);
  body_pending = false;
  body = "fresh body after reload";
  await client.load_skills();
  await settle();
  old("obsolete body");
  await settle();
  assert.ok(container.textContent.includes(body));
  assert.equal(container.textContent.includes("obsolete body"), false);
});

test("hiding during a pending body read does not poison the next view", async () => {
  show(client.SkillsPane);
  await settle();
  body_pending = true;
  click(view_button());
  await settle();
  const old = hold_body;
  assert.ok(old);
  click(view_button());
  old("obsolete hidden body");
  await settle();
  body_pending = false;
  body = "newly opened body";
  click(view_button());
  await settle();
  assert.ok(container.textContent.includes(body));
  assert.equal(container.textContent.includes("obsolete hidden body"), false);
});

test("a body read failure can be retried successfully", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  show(client.SkillsPane);
  await settle();
  body_error = true;
  click(view_button());
  await settle();
  assert.ok(container.textContent.includes("body read failed"));
  assert.equal(errors.mock.calls.length, 1);
  body_error = false;
  body = "recovered body";
  click(view_button());
  await settle();
  assert.ok(container.textContent.includes(body));
});

test("an old search response cannot replace newer results", async () => {
  show(client.SearchOverlay);
  search_type("first");
  await wait_search("first");
  search_type("second");
  await wait_search("second");
  searches.get("second")!.resolve([hit("current-chat")]);
  await settle();
  searches.get("first")!.resolve([hit("old-chat")]);
  await settle();
  assert.equal(matching("search-hit").length, 1);
  assert.ok(container.textContent.includes("current-chat"));
  enter();
  assert.equal(client.ui_store.get().active_chat_id, "current-chat");
});

test("clearing and retyping a query never revives its cached hits", async () => {
  show(client.SearchOverlay);
  search_type("same");
  await wait_search("same");
  searches.get("same")!.resolve([hit("old-chat")]);
  await settle();
  search_type("");
  search_type("same");
  assert.equal(matching("search-hit").length, 0);
  enter();
  assert.equal(client.ui_store.get().active_chat_id, null);
});

test("new search failure does not expose the old successful hits", async (t) => {
  t.mock.method(console, "error", () => {});
  show(client.SearchOverlay);
  search_type("first");
  await wait_search("first");
  searches.get("first")!.resolve([hit("old-chat")]);
  await settle();
  search_type("failed");
  await wait_search("failed");
  searches.get("failed")!.reject(new Error("search offline"));
  await settle();
  assert.equal(matching("search-hit").length, 0);
  enter();
  assert.equal(client.ui_store.get().active_chat_id, null);
});
