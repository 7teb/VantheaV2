import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type VirtualRowsProps<T> = {
  items: readonly T[];
  row_height: number;
  scroller: HTMLElement | null;
  render: (item: T, index: number) => ReactNode;
  className?: string;
  style?: CSSProperties;
};

type RowWindow = { start: number; end: number };

const overscan_rows = 8;

export const VirtualRows = <T,>({ items, row_height, scroller, render, className, style }: VirtualRowsProps<T>) => {
  const list = useRef<HTMLDivElement>(null);
  const [shown, set_shown] = useState<RowWindow>({ start: 0, end: 0 });
  const count = items.length;

  useLayoutEffect(() => {
    const host = scroller;
    const own = list.current;
    if (!host || !own) {
      return;
    }
    const measure = () => {
      const offset = own.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
      const top = host.scrollTop - offset;
      const start = Math.max(0, Math.floor(top / row_height) - overscan_rows);
      const end = Math.min(count, Math.ceil((top + host.clientHeight) / row_height) + overscan_rows);
      set_shown((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    measure();
    host.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => {
      host.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [scroller, count, row_height]);

  const rows: ReactNode[] = [];
  for (let index = shown.start; index < Math.min(shown.end, count); index += 1) {
    rows.push(render(items[index], index));
  }

  return (
    <div ref={list} className={className} style={{ ...style, position: "relative", height: count * row_height }}>
      <div style={{ transform: `translateY(${shown.start * row_height}px)` }}>{rows}</div>
    </div>
  );
};
