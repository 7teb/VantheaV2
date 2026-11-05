import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FetchError, FetchState, GitView } from "../shared/git-view.ts";
import type { FilesRoot } from "../shared/ipc/files.ts";
import { bundle, install_dom, stub_components, type FakeElement, type Vx } from "./dom-kit.ts";
import { repo } from "./git-view-kit.ts";

const listeners = new Map<string, (payload: any) => void>();
const project: FilesRoot = { path: "D:/project", name: "project", kind: "project" };

const vx: Vx = {
  invoke: async (name) => {
    if (name === "files:root") return project;
    if (name === "files:list") return { path: "", entries: [], more: 0 };
    return undefined;
  },
  on: (name, listener) => {
    listeners.set(name, listener);
    return () => {
      listeners.delete(name);
    };
  },
  send: () => {},
};

const tooltip_stub = `import { createElement } from "react"; export const Tooltip = (props) => createElement("span", { "data-tip": props.label }, props.children);`;

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const fetch_view = (fetch: Partial<FetchState>): GitView => repo({ fetch: { at: null, running: false, error: null, blocked: null, queued: false, ...fetch } });

const card = (view: GitView) => {
  listeners.get("git:changed")?.({ root: "D:/project", view });
  client.flushSync(() => root.render(client.createElement(client.GitCard)));
  const tips = container.matching((element) => element.getAttribute("data-tip") !== null).map((element) => element.getAttribute("data-tip"));
  const rows = container.matching((element) => element.className === "git-row").length;
  const commands = container.matching((element) => element.nodeName === "CODE").map((element) => element.textContent);
  return { text: container.textContent, tips, rows, commands };
};

const error = (kind: FetchError["kind"], extra: Partial<FetchError> = {}): FetchError => ({ kind, remote: "origin", host: "github.com", detail: "", command: null, ...extra });

const minutes_ago = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

before(async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  const window = Reflect.get(globalThis, "window") as Record<string, unknown>;
  window.setInterval = setInterval;
  window.clearInterval = clearInterval;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { init_files, sync_files } from "./src/state/files.ts";',
      'export { init_git } from "./src/state/git.ts";',
      'export { open_chat } from "./src/state/ui.ts";',
      'export { GitCard } from "./src/features/docks/files/git/GitCard.tsx";',
    ],
    [stub_components("GitLocalRow.tsx", { Tooltip: tooltip_stub }), stub_components("GitNotice.tsx", { Tooltip: tooltip_stub })],
  );
  client.init_files();
  client.init_git();
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
  client.open_chat("c1", "D:/project");
  await client.sync_files();
  await settled();
});

after(() => {
  root?.unmount();
  restore();
});

test("missing git credentials name the host and offer git fetch to copy with the sign-in hint", () => {
  const shown = card(fetch_view({ at: minutes_ago(12), error: error("auth_required", { command: "git fetch origin", detail: "fatal: could not read Username" }) }));
  assert.match(shown.text, /Git has no credentials for github\.com/);
  assert.deepEqual(shown.commands, ["git fetch origin"]);
  assert.ok(shown.tips.includes("Run this once in a terminal, then Git remembers the sign-in."));
  assert.equal(shown.rows, 2);
});

test("a rejected ssh key and an unknown host offer the ssh test command, a missing remote has no action", () => {
  const rejected = card(fetch_view({ error: error("ssh_key_rejected", { command: "ssh -T git@github.com" }) }));
  assert.match(rejected.text, /SSH key for github\.com rejected/);
  assert.deepEqual(rejected.commands, ["ssh -T git@github.com"]);
  const unknown = card(fetch_view({ error: error("ssh_host_unknown", { host: "github-work", command: "ssh -T git@github-work" }) }));
  assert.match(unknown.text, /Host github-work is not confirmed yet/);
  const missing = card(fetch_view({ error: error("remote_not_found") }));
  assert.match(missing.text, /origin not found or no access/);
  assert.deepEqual(missing.commands, []);
  assert.equal(container.matching((element) => element.className === "git-row-action").length, 0);
});

test("offline shows in the local row next to the age of the numbers, not as a notice", () => {
  const shown = card(fetch_view({ at: minutes_ago(12.5), error: error("offline") }));
  assert.match(shown.text, /offline·as of 12m ago/);
  assert.equal(shown.rows, 1);
  assert.match(card(fetch_view({ error: error("offline") })).text, /offline·not fetched yet/);
});

test("an unknown fetch failure shows git's line under the title", () => {
  const shown = card(fetch_view({ error: error("error", { detail: "fatal: unable to access 'https://github.com/o/r/': SSL certificate problem" }) }));
  assert.match(shown.text, /Fetch failedfatal: unable to access/);
});

test("a paused fetch explains itself on the fetch time, a queued one says it runs right after", () => {
  const paused = card(fetch_view({ at: minutes_ago(3), blocked: { kind: "agent_running" } }));
  assert.ok(paused.tips.includes("Fetch paused while the agent works"));
  assert.equal(paused.rows, 1);
  const queued = card(fetch_view({ at: minutes_ago(3), blocked: { kind: "agent_running" }, queued: true }));
  assert.ok(queued.tips.includes("Fetch paused while the agent works, it runs right after"));
});

test("automatic fetch off names the reason", () => {
  assert.match(card(fetch_view({ blocked: { kind: "insecure_transport", scheme: "http" } })).text, /Automatic fetch offUnencrypted connection/);
  assert.match(card(fetch_view({ blocked: { kind: "repo_config", keys: ["core.sshCommand", "credential.helper"] } })).text, /Repository configuration starts programs \(core\.sshCommand, credential\.helper\)/);
  assert.match(card(fetch_view({ blocked: { kind: "local_refspec", key: "remote.origin.fetch" } })).text, /Fetching would move local branches \(remote\.origin\.fetch\)/);
});
