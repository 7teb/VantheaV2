import { useLayoutEffect, useRef, useState } from "react";

const near_bottom_px = 80;

export const use_follow_bottom = (jump_key: string | number) => {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [away, set_away] = useState(false);

  const jump = () => {
    const node = scroller.current;
    if (!node) {
      return;
    }
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
    const on_scroll = () => {
      const near = node.scrollHeight - node.scrollTop - node.clientHeight < near_bottom_px;
      pinned.current = near;
      set_away(!near);
    };
    const observer = new ResizeObserver(() => {
      if (pinned.current) {
        node.scrollTop = node.scrollHeight;
      }
    });
    observer.observe(inner);
    observer.observe(node);
    node.addEventListener("scroll", on_scroll, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", on_scroll);
    };
  }, []);

  return { scroller, content, away, jump };
};
