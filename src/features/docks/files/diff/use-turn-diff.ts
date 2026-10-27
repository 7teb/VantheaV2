import { useMemo } from "react";
import type { Message } from "../../../../../shared/chat.ts";
import type { DiffEntry, DiffScope, DiffSummary } from "../../../../../shared/turn-diff.ts";
import { newest_span } from "../../../../../shared/turn-span.ts";
import { chat_messages } from "../../../../state/chat-view-reduce.ts";
import { chat_view_store } from "../../../../state/chat-view.ts";
import { files_store } from "../../../../state/files.ts";
import type { GitLoad } from "../../../../state/git-diff.ts";
import { turn_diff_ui_of, turn_diff_ui_store, type DiffRange } from "../../../../state/turn-diff-ui.ts";
import { use_turn_summary } from "../../../../state/turn-diff.ts";
import { use_store } from "../../../../state/use-store.ts";
import { openable } from "./diff-rows.ts";

export type TurnDiffModel = {
  has_turns: boolean;
  range: DiffRange;
  scope: DiffScope | null;
  started_at: string | null;
  load: GitLoad<DiffSummary> | null;
  entries: DiffEntry[];
  selected: DiffEntry | null;
};

const no_entries: DiffEntry[] = [];

const created_at = (messages: Message[], id: string | null): string | null => (id === null ? null : (messages.find((message) => message.id === id)?.created_at ?? null));

export const use_turn_diff = (chat_id: string | null, live: boolean, narrow: boolean): TurnDiffModel => {
  const key = use_store(files_store, (state) => state.key);
  const ui = use_store(turn_diff_ui_store, (state) => turn_diff_ui_of(state, key));
  const newest_from = use_store(chat_view_store, (state) => newest_span(chat_messages(state, chat_id))?.from_id ?? null);
  const newest_to = use_store(chat_view_store, (state) => newest_span(chat_messages(state, chat_id))?.to_id ?? null);
  const pinned_at = use_store(chat_view_store, (state) => created_at(chat_messages(state, chat_id), ui.span?.from_id ?? null));
  const newest_at = use_store(chat_view_store, (state) => created_at(chat_messages(state, chat_id), newest_from));
  const pinned = ui.span !== null && pinned_at !== null && ui.pinned_with === newest_from;
  const from_id = pinned ? (ui.span?.from_id ?? null) : newest_from;
  const to_id = pinned ? (ui.span?.to_id ?? null) : newest_to;
  const has_turns = newest_from !== null;
  const scope = useMemo((): DiffScope | null => {
    if (!has_turns) return null;
    if (ui.range === "chat") return { kind: "chat" };
    return from_id === null || to_id === null ? null : { kind: "turn", from_id, to_id };
  }, [has_turns, ui.range, from_id, to_id]);
  const load = use_turn_summary(chat_id, scope, live);
  const summary = load?.value;
  const entries = summary?.kind === "ready" ? summary.entries : no_entries;
  const chosen = entries.find((entry) => entry.path === ui.path && openable(entry));
  const selected = chosen ?? (narrow ? null : (entries.find(openable) ?? null));
  return { has_turns, range: ui.range, scope, started_at: pinned ? pinned_at : newest_at, load, entries, selected };
};
