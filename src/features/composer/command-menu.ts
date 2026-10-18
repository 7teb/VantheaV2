import type { ChatMeta } from "../../../shared/chat.ts";
import type { ModelEntry } from "../../../shared/models.ts";
import type { ModelContext } from "../../../shared/settings.ts";
import type { ReactNode } from "react";
import type { Translate } from "../../i18n/translate.ts";

export type CommandIcon = (props: { size?: number }) => ReactNode;

export type CommandContext = {
  chat_id: string | null;
  project_path: string;
  draft_key: string;
  chat: ChatMeta | null;
  last_message_id: string | null;
  busy: boolean;
  compacting: boolean;
  plan: boolean;
  visualize: boolean;
  usage_percent: number | null;
  model: ModelEntry | null;
  model_context: ModelContext | undefined;
  t: Translate;
  report: (text: string, tone: "note" | "error") => void;
};

export type ChatContext = CommandContext & { chat_id: string; chat: ChatMeta };

export type ModelCommandContext = CommandContext & { model: ModelEntry };

export type CommandOption = { id: string; label: string; hint?: string; checked?: boolean; run: () => void | Promise<void> };

type Runs<C> = { run: (context: C) => void | Promise<void>; options?: undefined } | { options: (context: C) => CommandOption[]; run?: undefined };

type Acts<C> = Runs<C> & { hint?: (context: C) => string | null; blocked?: (context: C) => string | null };

type Shown = {
  id: string;
  icon: (context: CommandContext) => CommandIcon;
  label: (context: CommandContext) => string;
  keywords?: string[];
  toggled?: (context: CommandContext) => boolean;
};

export type ComposerCommand = Shown &
  (({ needs: "none" | "project" } & Acts<CommandContext>) | ({ needs: "chat" | "idle_chat" } & Acts<ChatContext>) | ({ needs: "model" } & Acts<ModelCommandContext>));

export type CommandRow = {
  id: string;
  icon: CommandIcon;
  label: string;
  keywords: string[];
  hint: string | null;
  disabled: boolean;
  toggled: boolean | null;
  run: (() => void | Promise<void>) | null;
  options: (() => CommandOption[]) | null;
};

const shown_fields = (command: Shown, context: CommandContext) => ({
  id: command.id,
  icon: command.icon(context),
  label: command.label(context),
  keywords: command.keywords ?? [],
  toggled: command.toggled ? command.toggled(context) : null,
});

const blocked_row = (command: Shown, context: CommandContext, reason: string): CommandRow => ({
  ...shown_fields(command, context),
  hint: reason,
  disabled: true,
  run: null,
  options: null,
});

const active_row = <C extends CommandContext>(command: Shown & Acts<C>, context: C): CommandRow => {
  const reason = command.blocked?.(context) ?? null;
  if (reason !== null) {
    return blocked_row(command, context, reason);
  }
  const { run, options } = command;
  return {
    ...shown_fields(command, context),
    hint: command.hint?.(context) ?? null,
    disabled: false,
    run: run ? () => run(context) : null,
    options: options ? () => options(context) : null,
  };
};

export const command_row = (command: ComposerCommand, context: CommandContext): CommandRow => {
  if (command.needs === "none") {
    return active_row(command, context);
  }
  if (command.needs === "model") {
    const { model } = context;
    return model === null ? blocked_row(command, context, context.t("commands.no_model")) : active_row(command, { ...context, model });
  }
  if (command.needs === "project") {
    if ((context.chat?.project_path ?? context.project_path) === "") {
      return blocked_row(command, context, context.t("commands.needs_project"));
    }
    return context.busy ? blocked_row(command, context, context.t("commands.turn_running")) : active_row(command, context);
  }
  const { chat_id, chat } = context;
  if (chat_id === null || chat === null) {
    return blocked_row(command, context, context.t("commands.needs_chat"));
  }
  if (command.needs === "idle_chat" && context.busy) {
    return blocked_row(command, context, context.t("commands.turn_running"));
  }
  return active_row(command, { ...context, chat_id, chat });
};

export type SlashToken = { start: number; end: number; query: string };

const token_before = /(?:^|\s)\/([^\s/]*)$/;

const word_after = /^\S*/;

export const slash_token = (text: string, caret: number): SlashToken | null => {
  const at = Math.max(0, Math.min(caret, text.length));
  const match = token_before.exec(text.slice(0, at));
  if (!match) {
    return null;
  }
  const start = at - match[1].length - 1;
  const end = at + (word_after.exec(text.slice(at))?.[0].length ?? 0);
  return { start, end, query: text.slice(start + 1, end) };
};

export const without_token = (text: string, token: SlashToken): { text: string; caret: number } => {
  const before = text.slice(0, token.start);
  let after = text.slice(token.end);
  if (after.startsWith(" ") && (before === "" || /\s$/.test(before))) {
    after = after.slice(1);
  }
  return { text: before + after, caret: before.length };
};

export type Matchable = { id: string; label: string; keywords: string[] };

const word_starts = (value: string, query: string) => value.split(/[\s_-]+/).some((word) => word.startsWith(query));

const score = (item: Matchable, query: string): number | null => {
  const label = item.label.toLowerCase();
  if (label.startsWith(query)) {
    return 0;
  }
  if (word_starts(label, query) || item.id.startsWith(query)) {
    return 1;
  }
  if (item.keywords.some((keyword) => keyword.toLowerCase().startsWith(query))) {
    return 2;
  }
  if (label.includes(query)) {
    return 3;
  }
  return null;
};

export const filter_matches = <T extends Matchable>(items: T[], query: string): T[] => {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") {
    return items;
  }
  return items
    .map((item, index) => ({ item, index, rank: score(item, wanted) }))
    .filter((entry): entry is { item: T; index: number; rank: number } => entry.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.item);
};

export type LabelParts = { before: string; match: string; after: string };

export const label_parts = (label: string, query: string): LabelParts => {
  const wanted = query.trim().toLowerCase();
  const at = wanted === "" ? -1 : label.toLowerCase().indexOf(wanted);
  if (at === -1) {
    return { before: label, match: "", after: "" };
  }
  return { before: label.slice(0, at), match: label.slice(at, at + wanted.length), after: label.slice(at + wanted.length) };
};

export type SlashState = { key: string; caret: number; dismissed: number | null; active: number; parent: string | null; query: string | null };

export const fresh_slash = (key: string): SlashState => ({ key, caret: 0, dismissed: null, active: -1, parent: null, query: null });

export const settle_slash = (state: SlashState, key: string, query: string | null): SlashState => {
  let next = state.key === key ? state : fresh_slash(key);
  if (query !== next.query) {
    next = { ...next, query, parent: null, active: -1 };
  }
  if (query === null && next.dismissed !== null) {
    next = { ...next, dismissed: null };
  }
  return next;
};

export const slash_open = (token: SlashToken | null, state: SlashState, count: number): boolean => token !== null && state.dismissed !== token.start && count > 0;

export type Steppable = { disabled: boolean };

export const first_enabled = (items: Steppable[]): number => items.findIndex((item) => !item.disabled);

export const active_index = (items: (Steppable & { checked: boolean | null })[], wanted: number, in_submenu: boolean): number => {
  if (items[wanted] && !items[wanted].disabled) {
    return wanted;
  }
  const checked = in_submenu ? items.findIndex((item) => item.checked) : -1;
  return checked === -1 ? first_enabled(items) : checked;
};

export const step_enabled = (items: Steppable[], current: number, step: 1 | -1): number => {
  const count = items.length;
  if (first_enabled(items) === -1) {
    return -1;
  }
  let index = current < 0 || current >= count ? (step === 1 ? -1 : count) : current;
  for (let tries = 0; tries < count; tries += 1) {
    index = (index + step + count) % count;
    if (!items[index].disabled) {
      return index;
    }
  }
  return current;
};
