import type { ShortcutId } from "./shortcuts.ts";

export type FocusTarget = "terminal" | "composer" | "text" | "other";

export type FocusElement = { tagName: string; type?: string; isContentEditable?: boolean; closest: (selector: string) => unknown };

const non_text_inputs = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

export const focus_target = (element: FocusElement | null): FocusTarget => {
  if (element === null) {
    return "other";
  }
  if (element.closest(".xterm")) {
    return "terminal";
  }
  if (element.closest(".composer-input")) {
    return "composer";
  }
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || element.isContentEditable) {
    return "text";
  }
  return tag === "input" && !non_text_inputs.has((element.type ?? "text").toLowerCase()) ? "text" : "other";
};

const text_yields: ShortcutId[] = ["toggle_sidebar", "search"];

const yielding: Record<Exclude<FocusTarget, "other">, ReadonlySet<ShortcutId>> = {
  terminal: new Set<ShortcutId>(["new_chat", "open_project", "toggle_sidebar", "search", "prev_chat", "next_chat", "dictate", "copy_answer", "stop_turn"]),
  composer: new Set<ShortcutId>(text_yields),
  text: new Set<ShortcutId>([...text_yields, "stop_turn"]),
};

export const yields_to_focus = (id: ShortcutId, target: FocusTarget) => target !== "other" && yielding[target].has(id);
