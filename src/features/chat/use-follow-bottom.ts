import { useLayoutEffect, useRef, useState } from "react";

const near_bottom_px = 80;
const anchor_ms = 350;

export type KeepMode = "always" | "when_reading";

const anchor_breakers: Record<KeepMode, string[]> = {
  always: ["wheel", "touchmove", "pointerdown", "keydown"],
  when_reading: ["wheel", "touchmove"],
};

const anchors = new WeakMap<Element, (target: Element, mode: KeepMode) => void>();

export const keep_in_view = (target: Element, mode: KeepMode) => {
  for (let node = target.parentElement; node; node = node.parentElement) {
    const anchor = anchors.get(node);
    if (anchor) {
      anchor(target, mode);
      return;
    }
  }
};

export const use_follow_bottom = (jump_key: string | number) => {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const drop_anchor = useRef(() => {});
  const [away, set_away] = useState(false);

  const jump = () => {
    const node = scroller.current;
    if (!node) {
      return;
    }
    drop_anchor.current();
    pinned.current = true;
    set_away(false);
    node.scrollTop = node.scrollHeight;
  };

  useLayoutEffect(() => jump(), [jump_key]);

  useLayoutEffect(() => {
    const node = scroller.current;
    const inner = content.current;
    if (!node || !inner) {
      return;
    }
    let held: { target: Element; top: number; timer: number; breakers: string[] } | null = null;
    const on_scroll = () => {
      const near = node.scrollHeight - node.scrollTop - node.clientHeight < near_bottom_px;
      pinned.current = near;
      set_away(!near);
    };
    const hold = () => {
      if (!held) {
        return;
      }
      const drift = held.target.getBoundingClientRect().top - held.top;
      if (drift !== 0) {
        node.scrollTop += drift;
      }
    };
    const drop_hold = () => {
      if (!held) {
        return;
      }
      window.clearTimeout(held.timer);
      for (const name of held.breakers) {
        window.removeEventListener(name, release, true);
      }
      held = null;
    };
    const release = () => {
      if (held) {
        drop_hold();
        on_scroll();
      }
    };
    anchors.set(node, (target, mode) => {
      if (mode === "when_reading" && (pinned.current || target.getBoundingClientRect().top >= node.getBoundingClientRect().bottom)) {
        return;
      }
      drop_hold();
      held = { target, top: target.getBoundingClientRect().top, timer: window.setTimeout(release, anchor_ms), breakers: anchor_breakers[mode] };
      for (const name of held.breakers) {
        window.addEventListener(name, release, { capture: true, passive: true });
      }
      requestAnimationFrame(hold);
    });
    const observer = new ResizeObserver(() => {
      if (held) {
        hold();
        requestAnimationFrame(hold);
        return;
      }
      if (pinned.current) {
        node.scrollTop = node.scrollHeight;
      }
    });
    observer.observe(inner, { box: "border-box" });
    observer.observe(node);
    node.addEventListener("scroll", on_scroll, { passive: true });
    drop_anchor.current = drop_hold;
    return () => {
      drop_hold();
      drop_anchor.current = () => {};
      anchors.delete(node);
      observer.disconnect();
      node.removeEventListener("scroll", on_scroll);
    };
  }, []);

  return { scroller, content, away, jump };
};
