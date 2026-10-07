import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { class_names } from "./class-names.ts";
import "./Segmented.css";

export type SegmentedOption<T extends string> = { id: T; label: string };

type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  on_change: (id: T) => void;
  label: string;
  className?: string;
};

const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export const Segmented = <T extends string>({ options, value, on_change, label, className }: SegmentedProps<T>) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((option) => option.id === value));

  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = steps[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    on_change(options[next].id);
    buttons.current[next]?.focus();
  };

  return (
    <div
      className={class_names("segmented", className)}
      role="radiogroup"
      aria-label={label}
      onKeyDown={on_key_down}
      style={{ "--count": options.length, "--index": index } as CSSProperties}
    >
      {options.map((option, position) => {
        const selected = position === index;
        return (
          <button
            key={option.id}
            ref={(node) => {
              buttons.current[position] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="segment"
            onClick={() => on_change(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
