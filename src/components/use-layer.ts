import { useEffect, useRef, useState, type AnimationEvent } from "react";
import { push_layer } from "./layers.ts";

export const use_layer = (open: boolean, on_close: () => void) => {
  const latest = useRef(on_close);
  latest.current = on_close;
  useEffect(() => {
    if (!open) {
      return;
    }
    return push_layer(() => latest.current());
  }, [open]);
};

export type Presence = {
  mounted: boolean;
  state: "open" | "closed";
  on_animation_end: (event: AnimationEvent<HTMLElement>) => void;
};

export const use_presence = (open: boolean): Presence => {
  const [mounted, set_mounted] = useState(open);
  if (open && !mounted) {
    set_mounted(true);
  }
  return {
    mounted: open || mounted,
    state: open ? "open" : "closed",
    on_animation_end: (event) => {
      if (!open && event.target === event.currentTarget) {
        set_mounted(false);
      }
    },
  };
};

export const use_focus_return = (open: boolean) => {
  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);
};

const focusable_selector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export const focusable_within = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(focusable_selector)].filter((element) => element.tabIndex >= 0 && !element.closest("[inert]"));

type TabKey = { key: string; shiftKey: boolean; preventDefault: () => void };

export const trap_tab = (root: HTMLElement, event: TabKey) => {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = focusable_within(root);
  if (focusable.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
};
