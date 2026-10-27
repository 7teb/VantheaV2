import type { DiffScope } from "../../shared/turn-diff.ts";
import { chat_meta } from "../chats/store.ts";
import { require_record, require_string } from "../storage/coerce.ts";
import { turn_diffs } from "../turn-diff/index.ts";
import { emit, handle } from "./handle.ts";

const known_chat = (value: unknown): string => {
  const chat_id = require_string(value, "chat id", 200);
  if (!chat_meta(chat_id)) throw new Error(`chat ${chat_id} not found`);
  return chat_id;
};

const require_scope = (value: unknown): DiffScope => {
  const raw = require_record(value, "diff scope");
  if (raw.kind === "chat") return { kind: "chat" };
  if (raw.kind !== "turn") throw new Error('diff scope kind must be "turn" or "chat"');
  return { kind: "turn", from_id: require_string(raw.from_id, "first turn id", 200), to_id: require_string(raw.to_id, "last turn id", 200) };
};

const require_scopes = (value: unknown): DiffScope[] => {
  if (!Array.isArray(value)) throw new Error("diff scopes must be an array");
  return value.map(require_scope);
};

export const register_turn_diff_ipc = () => {
  turn_diffs.listen((change) => emit("turn_diff:changed", change));
  handle("turn_diff:summaries", (chat_id, scopes) => turn_diffs.summaries(known_chat(chat_id), require_scopes(scopes)));
  handle("turn_diff:file", (chat_id, scope, path) => turn_diffs.file(known_chat(chat_id), require_scope(scope), require_string(path, "file path", 4000)));
};
