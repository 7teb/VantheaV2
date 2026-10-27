import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { class_names } from "./class-names.ts";
import { Tooltip } from "./Tooltip.tsx";
import "./Segmented.css";

export type SegmentedOption<T extends string> = { id: T; label: string; icon?: ReactNode; count?: number; disabled?: boolean; tip?: string };

type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  on_change: (id: T) => void;
  label: string;
  className?: string;
  fit?: boolean;
  size?: "sm" | "md";
  tooltips?: boolean;
};

const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export const Segmented = <T extends string>({ options, value, on_change, label, className, fit = false, size = "md", tooltips = false }: SegmentedProps<T>) => {
  const group = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((option) => option.id === value));

  useLayoutEffect(() => {
    const node = group.current;
    if (!fit || !node) {
      return;
    }
    const place = () => {
      const button = buttons.current[index];
      if (!button) {
        return;
      }
      node.style.setProperty("--thumb-x", `${button.offsetLeft}px`);
      node.style.setProperty("--thumb-w", `${button.offsetWidth}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    for (const button of buttons.current.slice(0, options.length)) {
      if (button) {
        observer.observe(button);
      }
    }
    return () => observer.disconnect();
  }, [fit, index, options.length]);

  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = steps[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    for (let offset = 1; offset < options.length; offset += 1) {
      const next = (((index + step * offset) % options.length) + options.length) % options.length;
      if (options[next].disabled) {
        continue;
      }
      on_change(options[next].id);
      buttons.current[next]?.focus();
      return;
    }
  };

  return (
    <div
      ref={group}
      className={class_names("segmented", className)}
      role="radiogroup"
      aria-label={label}
      data-fit={fit}
      data-size={size}
      onKeyDown={on_key_down}
      style={{ "--count": options.length, "--index": index } as CSSProperties}
    >
      {options.map((option, position) => {
        const button = (
          <button
            key={option.id}
            ref={(node) => {
              buttons.current[position] = node;
            }}
            type="button"
            role="radio"
            aria-checked={position === index}
            tabIndex={position === index ? 0 : -1}
            disabled={option.disabled}
            className="segment"
            onClick={() => on_change(option.id)}
          >
            {option.icon && <span className="segment-icon">{option.icon}</span>}
            <span className="segment-label">{option.label}</span>
            {option.count !== undefined && <span className="segment-count">{option.count}</span>}
          </button>
        );
        const tip = tooltips ? (option.tip ?? option.label) : option.tip;
        return tip ? (
          <Tooltip key={option.id} label={tip}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
};
