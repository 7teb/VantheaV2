import type { ShortcutId } from "./shortcuts.ts";

type Binding = { id: number; run: () => boolean };

const bound = new Map<ShortcutId, Binding[]>();

let next_id = 0;

export const bind_shortcut = (shortcut: ShortcutId, run: () => boolean): (() => void) => {
  const binding = { id: ++next_id, run };
  bound.set(shortcut, [...(bound.get(shortcut) ?? []), binding]);
  return () => bound.set(shortcut, (bound.get(shortcut) ?? []).filter((entry) => entry.id !== binding.id));
};

export const run_bound = (shortcut: ShortcutId): boolean => bound.get(shortcut)?.at(-1)?.run() ?? false;
