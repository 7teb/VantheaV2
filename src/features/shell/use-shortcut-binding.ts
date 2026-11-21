import { useEffect, useRef } from "react";
import { bind_shortcut } from "./shortcut-bindings.ts";
import type { ShortcutId } from "./shortcuts.ts";

export const use_shortcut_binding = (shortcut: ShortcutId, enabled: boolean, run: () => boolean) => {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return bind_shortcut(shortcut, () => latest.current());
  }, [shortcut, enabled]);
};
