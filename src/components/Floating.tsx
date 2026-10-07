import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { class_names } from "./class-names.ts";
import { place, type Align, type Placed, type Placement, type Side } from "./placement.ts";
import { use_layer, use_presence } from "./use-layer.ts";
import "./Floating.css";

export type FloatingProps = {
  open: boolean;
  anchor: HTMLElement | null;
  on_close: () => void;
  placement?: Placement;
  className?: string;
  role?: string;
  label?: string;
  initial_focus?: (node: HTMLElement) => HTMLElement | null;
  min_width?: "anchor" | number;
  on_key_down?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

const opposite_edge: Record<Side, string> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const horizontal_align: Record<Align, string> = { start: "left", center: "center", end: "right" };
const vertical_align: Record<Align, string> = { start: "top", center: "center", end: "bottom" };

const transform_origin = (side: Side, align: Align) => {
  const cross = side === "top" || side === "bottom" ? horizontal_align : vertical_align;
  return `${opposite_edge[side]} ${cross[align]}`;
};

const opened_later = (own: HTMLElement, target: Node) => {
  const floating = target instanceof Element ? target.closest("[data-floating]") : null;
  return floating !== null && floating !== own && Boolean(own.compareDocumentPosition(floating) & Node.DOCUMENT_POSITION_FOLLOWING);
};

export const Floating = ({
  open,
  anchor,
  on_close,
  placement = "bottom-start",
  className,
  role,
  label,
  initial_focus,
  min_width,
  on_key_down,
  children,
}: FloatingProps) => {
  const presence = use_presence(open);
  const element = useRef<HTMLDivElement>(null);
  const latest_close = useRef(on_close);
  latest_close.current = on_close;
  const [placed, set_placed] = useState<Placed | null>(null);
  use_layer(open, on_close);

  useLayoutEffect(() => {
    const node = element.current;
    if (!open || !anchor || !node) {
      return;
    }
    const update = () => {
      const size = { width: node.offsetWidth, height: node.offsetHeight };
      set_placed(place(anchor.getBoundingClientRect(), size, placement, { width: window.innerWidth, height: window.innerHeight }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, anchor, placement, presence.mounted]);

  useEffect(() => {
    const node = element.current;
    if (!open || !node) {
      return;
    }
    const outside = (target: EventTarget | null) =>
      target instanceof Node && !node.contains(target) && !anchor?.contains(target) && !opened_later(node, target);
    const on_pointer_down = (event: PointerEvent) => {
      if (outside(event.target)) {
        latest_close.current();
      }
    };
    const on_scroll = (event: Event) => {
      if (anchor && event.target instanceof Node && event.target.contains(anchor)) {
        latest_close.current();
      }
    };
    document.addEventListener("pointerdown", on_pointer_down, true);
    window.addEventListener("scroll", on_scroll, true);
    return () => {
      document.removeEventListener("pointerdown", on_pointer_down, true);
      window.removeEventListener("scroll", on_scroll, true);
    };
  }, [open, anchor, presence.mounted]);

  useEffect(() => {
    const node = element.current;
    if (!open || !node) {
      return;
    }
    (initial_focus?.(node) ?? node).focus({ preventScroll: true });
    return () => {
      if (node.contains(document.activeElement)) {
        anchor?.focus({ preventScroll: true });
      }
    };
  }, [open, anchor, initial_focus, presence.mounted]);

  if (!presence.mounted) {
    return null;
  }

  const [, align] = placement.split("-") as [Side, Align];
  const anchor_width = anchor?.offsetWidth ?? 0;
  const style: CSSProperties = {
    left: placed?.left ?? 0,
    top: placed?.top ?? 0,
    minWidth: min_width === "anchor" ? anchor_width : min_width,
    transformOrigin: placed ? transform_origin(placed.side, align) : undefined,
  };

  return createPortal(
    <div
      ref={element}
      className={class_names("floating", className)}
      data-floating=""
      data-state={presence.state}
      data-side={placed?.side ?? "bottom"}
      data-placed={placed ? "true" : "false"}
      role={role}
      aria-label={label}
      tabIndex={-1}
      style={style}
      onKeyDown={on_key_down}
      onAnimationEnd={presence.on_animation_end}
    >
      {children}
    </div>,
    document.body,
  );
};
