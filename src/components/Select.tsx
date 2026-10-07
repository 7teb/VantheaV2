import { useState } from "react";
import { class_names } from "./class-names.ts";
import { ChevronDownIcon } from "./icons.tsx";
import { Menu } from "./Menu.tsx";
import type { Placement } from "./placement.ts";
import "./Select.css";

export type SelectOption<T extends string> = { id: T; label: string; hint?: string };

type SelectProps<T extends string> = {
  options: SelectOption<T>[];
  value: T;
  on_change: (id: T) => void;
  label: string;
  variant?: "control" | "ghost";
  placement?: Placement;
  disabled?: boolean;
  className?: string;
};

export const Select = <T extends string>({
  options,
  value,
  on_change,
  label,
  variant = "control",
  placement = "bottom-end",
  disabled = false,
  className,
}: SelectProps<T>) => {
  const [trigger, set_trigger] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const current = options.find((option) => option.id === value);

  return (
    <>
      <button
        ref={set_trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        className={class_names("select", `select-${variant}`, open && "is-open", className)}
        onClick={() => set_open((was_open) => !was_open)}
      >
        <span className="select-value">{current?.label ?? value}</span>
        <ChevronDownIcon size={14} className="select-chevron" />
      </button>
      <Menu
        open={open}
        anchor={trigger}
        label={label}
        placement={placement}
        min_width="anchor"
        on_close={() => set_open(false)}
        sections={[
          {
            id: "options",
            items: options.map((option) => ({
              id: option.id,
              label: option.label,
              hint: option.hint,
              checked: option.id === value,
              on_select: () => on_change(option.id),
            })),
          },
        ]}
      />
    </>
  );
};
