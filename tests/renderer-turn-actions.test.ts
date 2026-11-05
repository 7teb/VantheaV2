import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Message, UserMessage } from "../shared/chat.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";
import { regenerable_turn, turn_segments } from "../src/state/turn-groups.ts";
import { bundle, install_dom } from "./dom-kit.ts";
import { at, text, turn } from "./turn-fold-harness.ts";

let client: any;
let restore = () => {};

before(async () => {
  restore = install_dom({ invoke: async () => undefined, on: () => () => {}, send: () => {} }).restore;
  client = await bundle(['export { turn_info } from "./src/features/chat/turn-info.ts";'], []);
});

after(() => restore());

const en: Translate = (key, vars) => translate("en", key, vars);
const de: Translate = (key, vars) => translate("de", key, vars);

const user = (id: string, origin: UserMessage["origin"], value = "fix the parser"): UserMessage => ({ id, role: "user", text: value, attachments: [], origin, created_at: at(0) });

const source = (messages: Message[]) => regenerable_turn(turn_segments(messages))?.id ?? null;

test("only the newest answer to a message the user wrote can be regenerated", () => {
  assert.equal(source([user("u1", "user"), turn("a1", "done", [text("t", "done")])]), "u1");
  assert.equal(source([user("u1", "user"), turn("a1", "done", []), user("u2", "user"), turn("a2", "failed", [])]), "u2");
  assert.equal(source([user("u1", "user", ""), turn("a1", "done", [])]), "u1", "an attachment-only message can be sent again");
  assert.equal(source([user("u1", "user"), turn("a1", "done", []), user("p1", "plan_accept"), turn("a2", "done", [])]), null);
  assert.equal(source([user("u1", "user"), turn("a1", "done", []), user("x1", "undo"), turn("a2", "done", [])]), null);
  assert.equal(source([user("u1", "user"), turn("a1", "done", []), user("u2", "user")]), null, "no answer yet");
  assert.equal(source([turn("a1", "done", [])]), null);
  const joined: Message[] = [user("u1", "user"), turn("a1", "done", []), user("r1", "agent_report"), turn("a2", "done", [text("t", "Reader found it.")])];
  assert.equal(source(joined), "u1", "a turn joined by an agent report regenerates from the message that started it");
});

test("the info tooltip names effort, the time of the whole turn and the context, never the model", () => {
  const message = { ...turn("a3", "done", [], at(40_000), at(174_000)), model: "deepseek/deepseek-v4.1-flash", effort: "major", context: { used: 48_200, limit: 1_000_000 } };
  assert.equal(client.turn_info(en, message, at(0)), "Major · 2m 54s · 48k of 1.0M tokens");
  assert.equal(client.turn_info(de, message, at(0)), "Major · 2m 54s · 48k von 1.0M Tokens");
  const unknown = { ...turn("a4", "done", [], at(0), at(9_000)), model: "vendor/gone", effort: "", context: null };
  assert.equal(client.turn_info(en, unknown, at(0)), "9s");
  assert.equal(client.turn_info(en, { ...unknown, ended_at: null }, at(0)), "");
});
