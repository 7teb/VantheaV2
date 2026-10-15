import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type TransitionEvent } from "react";
import { agents_store } from "../../state/agents.ts";
import { turn_folds_store } from "../../state/turn-folds.ts";
import { use_store } from "../../state/use-store.ts";
import type { TurnShape } from "./turn-shape.ts";
import { keep_in_view } from "./use-follow-bottom.ts";
import "./TurnFold.css";

const keep_answer_in_view = (frame: Element) => {
  const items = Array.from(frame.children);
  const last = items.findLastIndex((item) => item.getAttribute("data-folded") === "true");
  const after = items[last + 1];
  if (last >= 0 && after) {
    keep_in_view(after, "when_reading");
  }
};

export const use_turn_folded = (chat_id: string, message_id: string, shape: TurnShape, frame: RefObject<HTMLDivElement | null>): boolean => {
  const chosen = use_store(turn_folds_store, (state) => state[chat_id]?.[message_id]);
  const holding = use_store(agents_store, (state) => shape.runs.some((ref) => state.known_runs[ref.run_id]?.status === "running"));
  const by_default = shape.foldable && !holding;
  const folded_before = useRef(by_default);
  useLayoutEffect(() => {
    const folding = by_default && !folded_before.current && chosen === undefined;
    folded_before.current = by_default;
    if (folding && frame.current) {
      keep_answer_in_view(frame.current);
    }
  }, [by_default, chosen, frame]);
  return shape.foldable && (chosen ?? !holding);
};

type FoldItemProps = { folded: boolean; children: ReactNode };

export const FoldItem = ({ folded, children }: FoldItemProps) => {
  const [view, set_view] = useState({ folded, seen: !folded, settled: !folded });
  if (view.folded !== folded) {
    set_view({ folded, seen: view.seen || !folded, settled: false });
  }
  const settle = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !folded) {
      set_view((current) => (current.settled ? current : { ...current, settled: true }));
    }
  };
  return (
    <div className="turn-fold-item" data-folded={folded} data-settled={view.settled} inert={folded} onTransitionEnd={settle}>
      <div className="turn-fold-clip">{view.seen && children}</div>
    </div>
  );
};
