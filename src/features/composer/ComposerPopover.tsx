import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { use_layer, use_presence } from "../../components/use-layer.ts";
import { focus_composer_input } from "./composer-hooks.ts";
import { fit_popover } from "./popover-room.ts";
import "./ComposerPopover.css";

type ComposerPopoverProps = {
  open: boolean;
  label: string;
  focus: "menu" | "input";
  keep: (target: Node) => boolean;
  on_close: () => void;
  on_key_down?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

const first_row = (node: HTMLElement) => node.querySelector<HTMLElement>(".composer-popover-row:not(:disabled)");

const other_open = (slot: HTMLElement, node: HTMLElement) =>
  [...slot.querySelectorAll('.composer-popover[data-state="open"]')].some((popover) => popover !== node);

export const ComposerPopover = ({ open, label, focus, keep, on_close, on_key_down, children }: ComposerPopoverProps) => {
  const presence = use_presence(open);
  const element = useRef<HTMLDivElement>(null);
  const latest = useRef({ keep, on_close });
  latest.current = { keep, on_close };
  use_layer(open, on_close);

  useLayoutEffect(() => {
    const node = element.current;
    const slot = node?.closest<HTMLElement>(".composer-slot");
    const composer = node?.closest<HTMLElement>(".composer");
    if (!open || !node || !slot || !composer) {
      return;
    }
    const measure = () => fit_popover(node, slot, composer);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(slot);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      if (!other_open(slot, node)) {
        slot.style.removeProperty("--composer-popover-lift");
        slot.style.removeProperty("--composer-card-cap");
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const on_pointer_down = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !element.current?.contains(target) && !latest.current.keep(target)) {
        latest.current.on_close();
      }
    };
    document.addEventListener("pointerdown", on_pointer_down, true);
    return () => document.removeEventListener("pointerdown", on_pointer_down, true);
  }, [open]);

  useEffect(() => {
    const node = element.current;
    if (!open || focus !== "menu" || !node) {
      return;
    }
    (first_row(node) ?? node).focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (node.contains(active) || active === null || active === document.body) {
        focus_composer_input(node);
      }
    };
  }, [open, focus, presence.mounted]);

  if (!presence.mounted) {
    return null;
  }

  return (
    <div
      ref={element}
      className="composer-popover"
      data-state={presence.state}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={on_key_down}
      onMouseDown={focus === "input" ? (event) => event.preventDefault() : undefined}
      onAnimationEnd={presence.on_animation_end}
    >
      {children}
    </div>
  );
};
