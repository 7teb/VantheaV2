import { useLayoutEffect, useRef } from "react";

const bottom_slack_px = 4;

export const use_pinned_bottom = (following: boolean) => {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(following);
  const live = useRef(following);

  useLayoutEffect(() => {
    live.current = following;
  }, [following]);

  useLayoutEffect(() => {
    const node = scroller.current;
    const inner = content.current;
    if (!node || !inner) {
      return;
    }
    const on_scroll = () => {
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight <= bottom_slack_px;
    };
    const on_click = () => {
      pinned.current = false;
    };
    const observer = new ResizeObserver(() => {
      if (live.current && pinned.current) {
        node.scrollTop = node.scrollHeight;
      }
    });
    observer.observe(inner);
    observer.observe(node);
    node.addEventListener("scroll", on_scroll, { passive: true });
    inner.addEventListener("click", on_click);
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", on_scroll);
      inner.removeEventListener("click", on_click);
    };
  }, []);

  return { scroller, content };
};
