import { useState, type KeyboardEvent } from "react";
import { use_layer } from "../../components/use-layer.ts";
import {
  active_index,
  command_row,
  filter_matches,
  fresh_slash,
  settle_slash,
  slash_open,
  slash_token,
  step_enabled,
  without_token,
  type CommandContext,
  type CommandIcon,
  type SlashState,
} from "./command-menu.ts";
import { composer_commands } from "./command-registry.ts";

export type SlashItem = {
  id: string;
  label: string;
  hint: string | null;
  icon: CommandIcon | null;
  disabled: boolean;
  toggled: boolean | null;
  checked: boolean | null;
  submenu: boolean;
};

type SlashEntry = { item: SlashItem; run: (() => void | Promise<void>) | null };

export type SlashMenu = {
  open: boolean;
  query: string;
  parent: string | null;
  items: SlashItem[];
  active: number;
  hover: (index: number) => void;
  select: (index: number) => void;
  back: () => void;
  close: () => void;
  track: (node: HTMLTextAreaElement) => void;
  on_key_down: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
};

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const use_slash_menu = (text: string, context: CommandContext, replace_text: (text: string, caret: number) => void): SlashMenu => {
  const [stored, set_stored] = useState<SlashState>(() => fresh_slash(context.draft_key));
  const caret = stored.key === context.draft_key ? stored.caret : 0;
  const token = slash_token(text, caret);
  const state = settle_slash(stored, context.draft_key, token?.query ?? null);
  if (state !== stored) {
    set_stored(state);
  }

  const rows = composer_commands.map((command) => command_row(command, context));
  const parent = state.parent === null ? null : (rows.find((row) => row.id === state.parent && row.options) ?? null);
  const entries: SlashEntry[] = parent?.options
    ? parent.options().map((option) => ({
        item: { id: option.id, label: option.label, hint: option.hint ?? null, icon: null, disabled: false, toggled: null, checked: option.checked ?? false, submenu: false },
        run: option.run,
      }))
    : filter_matches(token ? rows : [], token?.query ?? "").map((row) => ({
        item: { id: row.id, label: row.label, hint: row.hint, icon: row.icon, disabled: row.disabled, toggled: row.toggled, checked: null, submenu: row.options !== null },
        run: row.run,
      }));
  const items = entries.map((entry) => entry.item);
  const open = slash_open(token, state, items.length);
  const active = active_index(items, state.active, parent !== null);

  const close = () => set_stored((current) => ({ ...current, dismissed: token?.start ?? null, parent: null, active: -1 }));
  use_layer(open, close);

  const run_safely = (label: string, run: () => void | Promise<void>) => {
    Promise.resolve()
      .then(run)
      .catch((error: unknown) => {
        console.error(`[commands] ${label} failed for ${context.chat_id ?? context.draft_key}`, error);
        context.report(context.t("commands.failed", { action: label, error: error_text(error) }), "error");
      });
  };

  const select = (index: number) => {
    const entry = entries[index];
    if (!entry || !token) {
      return;
    }
    if (entry.item.submenu) {
      set_stored((current) => ({ ...current, parent: entry.item.id, active: -1 }));
      return;
    }
    const run = entry.run;
    if (run === null) {
      return;
    }
    const removed = without_token(text, token);
    replace_text(removed.text, removed.caret);
    set_stored((current) => ({ ...current, caret: removed.caret, parent: null, active: -1 }));
    run_safely(parent ? `${parent.label}: ${entry.item.label}` : entry.item.label, run);
  };

  const back = () => {
    const index = filter_matches(rows, token?.query ?? "").findIndex((row) => row.id === state.parent);
    set_stored((current) => ({ ...current, parent: null, active: index }));
  };

  const on_key_down = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = step_enabled(items, active, event.key === "ArrowDown" ? 1 : -1);
      set_stored((current) => ({ ...current, active: next }));
      return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      select(active);
      return true;
    }
    if (event.key === "ArrowRight" && items[active]?.submenu) {
      event.preventDefault();
      select(active);
      return true;
    }
    if ((event.key === "ArrowLeft" || event.key === "Backspace") && parent) {
      event.preventDefault();
      back();
      return true;
    }
    return false;
  };

  return {
    open,
    query: token?.query ?? "",
    parent: parent?.label ?? null,
    items,
    active,
    hover: (index) => {
      if (index !== active && items[index] && !items[index].disabled) {
        set_stored((current) => ({ ...current, active: index }));
      }
    },
    select,
    back,
    close,
    track: (node) => {
      const position = node.selectionStart;
      if (position !== caret) {
        set_stored((current) => ({ ...current, caret: position }));
      }
    },
    on_key_down,
  };
};
