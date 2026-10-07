import type { ReactNode } from "react";
import { class_names } from "./class-names.ts";
import { Floating } from "./Floating.tsx";
import type { Placement } from "./placement.ts";
import { focusable_within } from "./use-layer.ts";

const first_focusable = (node: HTMLElement) => focusable_within(node)[0] ?? null;

type PopoverProps = {
  open: boolean;
  anchor: HTMLElement | null;
  label: string;
  on_close: () => void;
  placement?: Placement;
  min_width?: "anchor" | number;
  className?: string;
  children: ReactNode;
};

export const Popover = ({ open, anchor, label, on_close, placement = "bottom-start", min_width, className, children }: PopoverProps) => (
  <Floating
    open={open}
    anchor={anchor}
    on_close={on_close}
    placement={placement}
    className={class_names("popover", className)}
    role="dialog"
    label={label}
    initial_focus={first_focusable}
    min_width={min_width}
  >
    {children}
  </Floating>
);
