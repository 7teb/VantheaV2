import type { KeyInput } from "./shortcuts.ts";

type RegionNode<T> = { closest(selector: string): T | null; querySelector(selector: string): T | null };

const region_selector = "[data-select-all]";

export const editable_selector = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export const is_select_all = (input: KeyInput): boolean =>
  (input.ctrlKey || input.metaKey) && !input.altKey && !input.shiftKey && input.key.toLowerCase() === "a";

export const select_all_region = <T extends RegionNode<T>>(focused: T | null, pointer: T | null): T | null => {
  if (focused) {
    return focused.querySelector(region_selector) ?? focused.closest(region_selector);
  }
  return pointer?.closest(region_selector) ?? null;
};
