import { useLayoutEffect, useRef, type RefObject } from "react";

type Placed = { row: HTMLElement; top: number; trailing: Element | null; entering: Animation[] };

type Snapshot = { container: HTMLElement; rows: Map<string, Placed> };

const entry_animations = new Set(["fade-up", "fade-in"]);

const top_in_list = (row: HTMLElement, list: HTMLElement) => (row.offsetParent === list ? row.offsetTop : row.offsetTop - list.offsetTop);

const entries_of = (element: Element | null) =>
  (element?.getAnimations() ?? []).filter((animation) => animation instanceof CSSAnimation && entry_animations.has(animation.animationName));

const keep_running = (animations: Animation[], kept: Animation[]) =>
  animations.filter((animation) => {
    if (kept.includes(animation)) {
      return true;
    }
    animation.finish();
    return false;
  });

const sliding_offset = (row: HTMLElement) =>
  row.getAnimations().some((animation) => animation instanceof CSSTransition && animation.transitionProperty === "transform")
    ? new DOMMatrixReadOnly(getComputedStyle(row).transform).m42
    : 0;

const slide = (row: HTMLElement, offset: number) => {
  row.style.transition = "none";
  row.style.transform = `translateY(${offset}px)`;
  row.getBoundingClientRect();
  row.style.removeProperty("transition");
  row.style.removeProperty("transform");
};

const settle_row = (row: HTMLElement, trailing: Element | null, was: Placed | undefined, first: boolean): Animation[] => {
  if (first) {
    keep_running([...entries_of(row), ...entries_of(trailing)], []);
    return [];
  }
  if (was === undefined || was.row !== row) {
    return [...entries_of(row), ...entries_of(trailing)];
  }
  const trailing_kept = was.trailing === trailing ? was.entering : entries_of(trailing);
  return [...keep_running(entries_of(row), was.entering), ...keep_running(entries_of(trailing), trailing_kept)];
};

export const use_row_motion = (container: RefObject<HTMLElement | null>) => {
  const previous = useRef<Snapshot | null>(null);
  useLayoutEffect(() => {
    const node = container.current;
    if (node === null) {
      previous.current = null;
      return;
    }
    const before = previous.current?.container === node ? previous.current.rows : null;
    const rows = new Map<string, Placed>();
    for (const row of node.querySelectorAll<HTMLElement>(".chat-row[data-chat-id]")) {
      const list = row.parentElement;
      const id = row.dataset.chatId;
      if (list === null || id === undefined) {
        continue;
      }
      const was = before?.get(id);
      const top = top_in_list(row, list);
      const trailing = row.querySelector(".chat-row-time, .chat-row-status");
      const entering = settle_row(row, trailing, was, before === null);
      rows.set(id, { row, top, trailing, entering });
      if (was === undefined || was.row !== row) {
        continue;
      }
      const offset = was.top - top + sliding_offset(row);
      if (Math.abs(offset) >= 1) {
        slide(row, offset);
      }
    }
    previous.current = { container: node, rows };
  });
};
