import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { place_visible } from "./Floating.tsx";
import type { Placed, Placement } from "./placement.ts";
import "./Tooltip.css";

type TooltipProps = {
  label: string;
  hint?: string;
  placement?: Placement;
  children: ReactNode;
};

const show_delay_ms = 450;

export const Tooltip = ({ label, hint, placement = "bottom-center", children }: TooltipProps) => {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const [visible, set_visible] = useState(false);
  const [placed, set_placed] = useState<Placed | null>(null);

  const show = (delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set_visible(true), delay);
  };

  const hide = () => {
    window.clearTimeout(timer.current);
    set_visible(false);
    set_placed(null);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    const target = anchor.current?.firstElementChild;
    const node = bubble.current;
    if (!visible || !target || !node) {
      return;
    }
    const size = { width: node.offsetWidth, height: node.offsetHeight };
    set_placed(place_visible(target.getBoundingClientRect(), size, placement));
  }, [visible, placement, label, hint]);

  return (
    <span
      ref={anchor}
      className="tooltip-anchor"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          show(show_delay_ms);
        }
      }}
      onPointerLeave={hide}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) {
          show(0);
        }
      }}
      onBlur={hide}
      onPointerDown={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          hide();
        }
      }}
    >
      {children}
      {visible &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            className="tooltip raised-surface"
            data-placed={placed ? "true" : "false"}
            style={{ left: placed?.left ?? 0, top: placed?.top ?? 0 }}
          >
            <span>{label}</span>
            {hint && <kbd className="tooltip-hint">{hint}</kbd>}
          </div>,
          document.body,
        )}
    </span>
  );
};
