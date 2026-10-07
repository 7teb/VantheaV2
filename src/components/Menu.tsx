import type { KeyboardEvent, ReactNode } from "react";
import { class_names } from "./class-names.ts";
import { Floating } from "./Floating.tsx";
import { CheckIcon } from "./icons.tsx";
import type { Placement } from "./placement.ts";
import "./Menu.css";

export type MenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  on_select: () => void;
};

export type MenuSection = { id: string; label?: string; items: MenuItem[] };

type MenuProps = {
  open: boolean;
  anchor: HTMLElement | null;
  label: string;
  sections: MenuSection[];
  on_close: () => void;
  placement?: Placement;
  min_width?: "anchor" | number;
  className?: string;
};

const first_item = (node: HTMLElement) => node.querySelector<HTMLElement>(".menu-item:not(:disabled)");

type Step = 1 | -1 | "first" | "last";

const menu_keys: Record<string, Step> = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" };

const target_index = (current: number, count: number, step: Step) => {
  if (step === "first") {
    return 0;
  }
  if (step === "last") {
    return count - 1;
  }
  if (current === -1) {
    return step > 0 ? 0 : count - 1;
  }
  return (current + step + count) % count;
};

const move_focus = (container: HTMLElement, step: Step) => {
  const items = [...container.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
  if (items.length === 0) {
    return;
  }
  const current = items.findIndex((item) => item === document.activeElement);
  items[target_index(current, items.length, step)].focus();
};

export const Menu = ({ open, anchor, label, sections, on_close, placement = "bottom-start", min_width = 200, className }: MenuProps) => {
  const selectable = sections.some((section) => section.items.some((item) => item.checked !== undefined));

  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = menu_keys[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move_focus(event.currentTarget, step);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      on_close();
    }
  };

  const select = (item: MenuItem) => {
    on_close();
    item.on_select();
  };

  return (
    <Floating
      open={open}
      anchor={anchor}
      on_close={on_close}
      placement={placement}
      className={class_names("menu", className)}
      role="menu"
      label={label}
      initial_focus={first_item}
      min_width={min_width}
      on_key_down={on_key_down}
    >
      {sections.map((section) => (
        <div key={section.id} className="menu-section" role="group" aria-label={section.label}>
          {section.label && <div className="menu-section-label section-label">{section.label}</div>}
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked}
              tabIndex={-1}
              disabled={item.disabled}
              className={class_names("menu-item", item.danger && "is-danger")}
              onClick={() => select(item)}
            >
              {item.icon && <span className="menu-item-icon">{item.icon}</span>}
              <span className="menu-item-label">{item.label}</span>
              {item.hint && <span className="menu-item-hint">{item.hint}</span>}
              {selectable && <span className="menu-item-check">{item.checked && <CheckIcon size={15} />}</span>}
            </button>
          ))}
        </div>
      ))}
    </Floating>
  );
};
