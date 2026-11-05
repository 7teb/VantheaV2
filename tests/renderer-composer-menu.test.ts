import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMeta } from "../shared/chat.ts";
import {
  active_index,
  command_row,
  filter_matches,
  first_enabled,
  fresh_slash,
  label_parts,
  settle_slash,
  slash_open,
  slash_token,
  step_enabled,
  without_token,
  type CommandContext,
  type CommandIcon,
  type ComposerCommand,
} from "../src/features/composer/command-menu.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const icon: CommandIcon = () => null;

const chat: ChatMeta = {
  id: "c1",
  title: "Chat",
  project_path: "D:\\p",
  workspace: "",
  pinned: false,
  created_at: "2026-10-15T10:00:00.000Z",
  updated_at: "2026-10-15T10:00:00.000Z",
  message_count: 2,
  streaming: false,
};

const context = (patch: Partial<CommandContext> = {}): CommandContext => ({
  chat_id: "c1",
  project_path: "D:\\p",
  draft_key: "c1",
  chat,
  last_message_id: "m2",
  busy: false,
  compacting: false,
  plan: false,
  visualize: false,
  usage_percent: 40,
  model: null,
  model_context: undefined,
  pro: false,
  tier: null,
  t,
  report: () => {},
  ...patch,
});

test("a slash opens a token only at the start of the draft or after whitespace", () => {
  assert.deepEqual(slash_token("/", 1), { start: 0, end: 1, query: "" });
  assert.deepEqual(slash_token("/comp", 5), { start: 0, end: 5, query: "comp" });
  assert.deepEqual(slash_token("fix this /fo", 12), { start: 9, end: 12, query: "fo" });
  assert.deepEqual(slash_token("line\n/pin", 9), { start: 5, end: 9, query: "pin" });
  assert.equal(slash_token("src/main.ts", 4), null);
  assert.equal(slash_token("a/b", 3), null);
  assert.equal(slash_token("/compact now", 12), null);
  assert.equal(slash_token("", 0), null);
});

test("the token covers the whole word around the caret and clamps a stale caret", () => {
  assert.deepEqual(slash_token("/compact", 3), { start: 0, end: 8, query: "compact" });
  assert.deepEqual(slash_token("/fork more", 2), { start: 0, end: 5, query: "fork" });
  assert.deepEqual(slash_token("/pin", 40), { start: 0, end: 4, query: "pin" });
  assert.equal(slash_token("x /y", 1), null);
});

test("removing a token leaves the rest of the draft and drops one doubled space", () => {
  assert.deepEqual(without_token("/compact", { start: 0, end: 8, query: "compact" }), { text: "", caret: 0 });
  assert.deepEqual(without_token("/plan write it", { start: 0, end: 5, query: "plan" }), { text: "write it", caret: 0 });
  assert.deepEqual(without_token("please /fork now", { start: 7, end: 12, query: "fork" }), { text: "please now", caret: 7 });
  assert.deepEqual(without_token("end /pin", { start: 4, end: 8, query: "pin" }), { text: "end ", caret: 4 });
});

const items = [
  { id: "compact", label: "Compact", keywords: ["context", "summary"] },
  { id: "fork", label: "Fork chat", keywords: ["branch"] },
  { id: "pin", label: "Pin chat", keywords: ["unpin"] },
  { id: "plan", label: "Plan mode", keywords: ["planning"] },
];

test("filtering keeps registry order for an empty query and ranks label prefixes first", () => {
  assert.deepEqual(filter_matches(items, "").map((item) => item.id), ["compact", "fork", "pin", "plan"]);
  assert.deepEqual(filter_matches(items, "p").map((item) => item.id), ["pin", "plan", "compact"]);
  assert.deepEqual(filter_matches(items, "chat").map((item) => item.id), ["fork", "pin"]);
  assert.deepEqual(filter_matches(items, "BRANCH").map((item) => item.id), ["fork"]);
  assert.deepEqual(filter_matches(items, "mod").map((item) => item.id), ["plan"]);
  assert.deepEqual(filter_matches(items, "act").map((item) => item.id), ["compact"]);
  assert.deepEqual(filter_matches(items, "zzz"), []);
});

test("a localized label still matches its English id and keywords", () => {
  const german = [{ id: "compact", label: "Komprimieren", keywords: ["context"] }, { id: "fork", label: "Chat verzweigen", keywords: [] }];
  assert.deepEqual(filter_matches(german, "comp").map((item) => item.id), ["compact"]);
  assert.deepEqual(filter_matches(german, "kom").map((item) => item.id), ["compact"]);
  assert.deepEqual(filter_matches(german, "verz").map((item) => item.id), ["fork"]);
});

test("the matched part of a label is split out for highlighting", () => {
  assert.deepEqual(label_parts("Fork chat", "ch"), { before: "Fork ", match: "ch", after: "at" });
  assert.deepEqual(label_parts("Compact", "COM"), { before: "", match: "Com", after: "pact" });
  assert.deepEqual(label_parts("Compact", ""), { before: "Compact", match: "", after: "" });
  assert.deepEqual(label_parts("Compact", "zz"), { before: "Compact", match: "", after: "" });
});

test("stepping skips disabled rows, wraps, and reports none when everything is disabled", () => {
  const rows = [{ disabled: true }, { disabled: false }, { disabled: true }, { disabled: false }];
  assert.equal(first_enabled(rows), 1);
  assert.equal(step_enabled(rows, 1, 1), 3);
  assert.equal(step_enabled(rows, 3, 1), 1);
  assert.equal(step_enabled(rows, 1, -1), 3);
  assert.equal(step_enabled(rows, -1, 1), 1);
  assert.equal(step_enabled(rows, -1, -1), 3);
  assert.equal(step_enabled([{ disabled: true }], 0, 1), -1);
  assert.equal(first_enabled([]), -1);
});

const ran: string[] = [];

const commands: ComposerCommand[] = [
  { id: "plan", needs: "none", icon: () => icon, label: () => "Plan mode", toggled: ({ plan }) => plan, run: () => void ran.push("plan") },
  { id: "pin", needs: "chat", icon: () => icon, label: ({ chat: meta }) => (meta?.pinned ? "Unpin chat" : "Pin chat"), run: ({ chat: meta }) => void ran.push(`pin:${meta.id}`) },
  {
    id: "compact",
    needs: "idle_chat",
    icon: () => icon,
    label: () => "Compact",
    hint: ({ usage_percent }) => `${usage_percent}%`,
    blocked: ({ compacting }) => (compacting ? "Compacting" : null),
    run: ({ chat_id }) => void ran.push(`compact:${chat_id}`),
  },
  {
    id: "limit",
    needs: "chat",
    icon: () => icon,
    label: () => "Context limit",
    options: ({ chat_id }) => [{ id: "max", label: "Max", checked: true, run: () => void ran.push(`limit:${chat_id}`) }],
  },
];

const row = (id: string, ctx: CommandContext) => command_row(commands.find((command) => command.id === id) ?? commands[0], ctx);

test("commands without a chat requirement run in a new chat and expose their toggle state", () => {
  const plan = row("plan", context({ chat_id: null, chat: null, plan: true }));
  assert.equal(plan.disabled, false);
  assert.equal(plan.toggled, true);
  assert.equal(plan.hint, null);
  plan.run?.();
  assert.deepEqual(ran.splice(0), ["plan"]);
});

test("chat commands are disabled with a reason until a chat exists", () => {
  for (const id of ["pin", "compact", "limit"]) {
    const blocked = row(id, context({ chat_id: null, chat: null }));
    assert.equal(blocked.disabled, true, id);
    assert.equal(blocked.hint, "Needs a chat", id);
    assert.equal(blocked.run, null, id);
    assert.equal(blocked.options, null, id);
  }
  assert.equal(row("pin", context({ chat: { ...chat, pinned: true } })).label, "Unpin chat");
});

test("idle commands are blocked while a turn runs, plain chat commands are not", () => {
  const busy = context({ busy: true });
  assert.equal(row("compact", busy).disabled, true);
  assert.equal(row("compact", busy).hint, "Turn running");
  assert.equal(row("pin", busy).disabled, false);
  row("pin", busy).run?.();
  assert.deepEqual(ran.splice(0), ["pin:c1"]);
});

test("a command's own block reason replaces its hint, otherwise the hint shows", () => {
  assert.equal(row("compact", context()).hint, "40%");
  const compacting = row("compact", context({ compacting: true }));
  assert.equal(compacting.disabled, true);
  assert.equal(compacting.hint, "Compacting");
  row("compact", context()).run?.();
  assert.deepEqual(ran.splice(0), ["compact:c1"]);
});

test("a command with options opens a submenu instead of running", () => {
  const limit = row("limit", context());
  assert.equal(limit.run, null);
  const options = limit.options?.() ?? [];
  assert.deepEqual(options.map((option) => [option.id, option.checked]), [["max", true]]);
  void options[0].run();
  assert.deepEqual(ran.splice(0), ["limit:c1"]);
});

test("escape keeps the menu closed for that slash until the token is gone", () => {
  const token = slash_token("/co", 3);
  let state = settle_slash(fresh_slash("c1"), "c1", "co");
  assert.equal(slash_open(token, state, 2), true);
  state = { ...state, dismissed: 0 };
  assert.equal(slash_open(token, settle_slash(state, "c1", "com"), 2), false);
  state = settle_slash(state, "c1", null);
  assert.equal(state.dismissed, null);
  assert.equal(slash_open(slash_token("/", 1), settle_slash(state, "c1", ""), 2), true);
  assert.equal(slash_open(token, state, 0), false);
  assert.equal(slash_open(null, state, 3), false);
});

test("typing resets the highlight and leaves a submenu, a chat switch resets everything", () => {
  const open = { ...fresh_slash("c1"), caret: 4, query: "aut", parent: "auto_compact", active: 2 };
  assert.equal(settle_slash(open, "c1", "aut"), open);
  const typed = settle_slash(open, "c1", "auto");
  assert.deepEqual([typed.parent, typed.active, typed.caret], [null, -1, 4]);
  const switched = settle_slash({ ...open, dismissed: 0 }, "c2", null);
  assert.deepEqual(switched, fresh_slash("c2"));
});

test("the highlight falls back to the checked option in a submenu and to the first enabled row otherwise", () => {
  const rows = [
    { disabled: true, checked: null },
    { disabled: false, checked: null },
    { disabled: false, checked: null },
  ];
  assert.equal(active_index(rows, 2, false), 2);
  assert.equal(active_index(rows, 0, false), 1);
  assert.equal(active_index(rows, -1, false), 1);
  const options = [
    { disabled: false, checked: false },
    { disabled: false, checked: true },
  ];
  assert.equal(active_index(options, -1, true), 1);
  assert.equal(active_index(options, 0, true), 0);
  assert.equal(active_index([{ disabled: true, checked: null }], -1, false), -1);
});
