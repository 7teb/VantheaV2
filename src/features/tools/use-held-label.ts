import { useEffect, useRef, useState } from "react";

const label_hold_ms = 650;

type Shown<T> = { key: string; value: T; since: number };

export const use_held_label = <T>(key: string, value: T): T => {
  const [shown, set_shown] = useState<Shown<T>>(() => ({ key, value, since: Date.now() }));
  const latest = useRef({ key, value });
  const now = Date.now();
  const due = key !== shown.key && now - shown.since >= label_hold_ms;
  if (due) {
    set_shown({ key, value, since: now });
  }
  const held = key !== shown.key && !due;
  useEffect(() => {
    latest.current = { key, value };
  });
  useEffect(() => {
    if (!held) {
      return;
    }
    const timer = window.setTimeout(() => set_shown({ ...latest.current, since: Date.now() }), Math.max(0, shown.since + label_hold_ms - Date.now()));
    return () => window.clearTimeout(timer);
  }, [held, key, shown]);
  return held ? shown.value : value;
};
