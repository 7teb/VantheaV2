import type { CSSProperties } from "react";
import { class_names } from "./class-names.ts";
import "./Slider.css";

type SliderProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  on_change: (value: number) => void;
  label: string;
  value_text?: string;
  stops?: boolean;
  disabled?: boolean;
  className?: string;
};

export const Slider = ({ value, min, max, step = 1, on_change, label, value_text, stops = false, disabled = false, className }: SliderProps) => {
  const span = max - min;
  const fill = span > 0 ? ((value - min) / span) * 100 : 0;
  const stop_count = stops && step > 0 ? Math.round(span / step) + 1 : 0;
  return (
    <div className={class_names("slider", className)} style={{ "--fill": `${fill}%` } as CSSProperties}>
      {stop_count > 1 && (
        <div className="slider-stops" aria-hidden="true">
          {Array.from({ length: stop_count }, (_, index) => (
            <span key={index} className="slider-stop" data-filled={min + index * step <= value} />
          ))}
        </div>
      )}
      <input
        type="range"
        className="slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={value_text}
        onChange={(event) => on_change(Number(event.target.value))}
      />
    </div>
  );
};
