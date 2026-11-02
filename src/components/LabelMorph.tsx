import { useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties, type ReactNode } from "react";
import "./LabelMorph.css";

type Shown = { key: string; id: number; leaving: { id: number; content: ReactNode } | null };

type Glide = { id: number; from: number; to: number; turn: 0 | 1 };

const natural_width = (item: HTMLElement) => {
  item.style.width = "max-content";
  const width = item.getBoundingClientRect().width;
  item.style.removeProperty("width");
  return width;
};

export const LabelMorph = ({ morph_key, children }: { morph_key: string; children: ReactNode }) => {
  const root = useRef<HTMLSpanElement>(null);
  const leaving_item = useRef<HTMLSpanElement>(null);
  const entering_item = useRef<HTMLSpanElement>(null);
  const committed = useRef<ReactNode>(children);
  const [shown, set_shown] = useState<Shown>({ key: morph_key, id: 0, leaving: null });
  const [glide, set_glide] = useState<Glide | null>(null);
  if (shown.key !== morph_key) {
    set_shown({ key: morph_key, id: shown.id + 1, leaving: { id: shown.id, content: committed.current } });
  }

  useLayoutEffect(() => {
    committed.current = children;
  });

  useLayoutEffect(() => {
    const leaving = shown.leaving;
    const node = root.current;
    const before = leaving_item.current;
    const after = entering_item.current;
    if (leaving === null || node === null || before === null || after === null) {
      return;
    }
    const from = node.dataset.glide === undefined ? natural_width(before) : node.getBoundingClientRect().width;
    const to = natural_width(after);
    set_glide((current) => (Math.abs(to - from) < 0.5 ? null : { id: leaving.id, from, to, turn: current?.turn === 0 ? 1 : 0 }));
  }, [shown]);

  const settle = (id: number) => (event: AnimationEvent<HTMLSpanElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    set_shown((state) => (state.leaving?.id === id ? { ...state, leaving: null } : state));
    set_glide((current) => (current?.id === id ? null : current));
  };

  const style = glide ? ({ "--morph-from": `${glide.from}px`, "--morph-to": `${glide.to}px` } as CSSProperties) : undefined;
  return (
    <span ref={root} className="label-morph" data-glide={glide?.turn} style={style}>
      {shown.leaving && (
        <span key={shown.leaving.id} ref={leaving_item} className="label-morph-item" data-phase="out" aria-hidden="true" onAnimationEnd={settle(shown.leaving.id)}>
          {shown.leaving.content}
        </span>
      )}
      <span key={shown.id} ref={entering_item} className="label-morph-item" data-phase={shown.id === 0 ? undefined : "in"}>
        {children}
      </span>
    </span>
  );
};
