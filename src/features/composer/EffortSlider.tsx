import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import "./EffortSlider.css";

type EffortSliderProps = {
  index: number;
  count: number;
  highlighted: boolean;
  label: string;
  value_text: string;
  on_change: (index: number) => void;
};

type Track = { start: number; width: number };

type Grab = Track & { offset: number };

const track_inset = 13;

const sparks = [
  { x: 46, y: -5, delay: 0 },
  { x: 78, y: 4, delay: 40 },
  { x: 62, y: -1, delay: 90 },
  { x: 104, y: -6, delay: 130 },
  { x: 88, y: 6, delay: 170 },
  { x: 124, y: 1, delay: 220 },
  { x: 56, y: 7, delay: 260 },
];

const track_of = (node: HTMLElement): Track => {
  const rect = node.getBoundingClientRect();
  return { start: rect.left + track_inset, width: rect.width - 2 * track_inset };
};

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

export const EffortSlider = ({ index, count, highlighted, label, value_text, on_change }: EffortSliderProps) => {
  const input = useRef<HTMLInputElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const grab = useRef<Grab | null>(null);
  const [pressed, set_pressed] = useState(false);
  const [drag, set_drag] = useState<number | null>(null);
  const [keyboard, set_keyboard] = useState(false);
  const last = count - 1;
  const position = drag ?? (index / last) * 100;

  const select = (next: number) => {
    if (next !== index) {
      on_change(next);
    }
  };

  const nearest = (x: number, track: Track) => Math.round(clamp(((x - track.start) / track.width) * last, last));

  const on_pointer_down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    input.current?.focus({ preventScroll: true });
    set_keyboard(false);
    set_pressed(true);
    const track = track_of(event.currentTarget);
    const box = thumb.current?.getBoundingClientRect();
    const on_thumb = box !== undefined && event.clientX >= box.left && event.clientX <= box.right;
    if (!on_thumb) {
      grab.current = null;
      select(nearest(event.clientX, track));
      return;
    }

    grab.current = { ...track, offset: event.clientX - track.start - (position / 100) * track.width };
  };

  const on_pointer_move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pressed) {
      return;
    }

    const held = grab.current;
    if (!held) {
      select(nearest(event.clientX, track_of(event.currentTarget)));
      return;
    }

    const value = clamp(((event.clientX - held.start - held.offset) / held.width) * last, last);
    set_drag((value / last) * 100);
    select(Math.round(value));
  };

  const release = () => {
    grab.current = null;
    set_pressed(false);
    set_drag(null);
  };

  const on_key_down = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      set_keyboard(true);
    }
  };

  return (
    <div className="effort-slider" data-keyboard={keyboard}>
      <div
        className="effort-slider-root"
        data-pressed={pressed}
        data-dragging={drag !== null}
        data-highlighted={highlighted}
        style={{ "--at": position } as CSSProperties}
        onPointerDown={on_pointer_down}
        onPointerMove={on_pointer_move}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <div className="effort-slider-track">
          <div className="effort-slider-range" />
          {Array.from({ length: count }, (_, stop) => (
            <span key={stop} className="effort-slider-tick" data-selected={stop <= index} style={{ "--stop": (stop / last) * 100 } as CSSProperties} />
          ))}
          {highlighted && (
            <span className="effort-slider-sparks" aria-hidden="true">
              {sparks.map((spark, number) => (
                <span
                  key={number}
                  className="effort-slider-spark"
                  style={{ "--spark-x": spark.x, "--spark-y": spark.y, "--spark-delay": spark.delay } as CSSProperties}
                />
              ))}
            </span>
          )}
        </div>
        <span ref={thumb} className="effort-slider-thumb-at">
          <span className="effort-slider-thumb" />
        </span>
        <input
          ref={input}
          type="range"
          className="effort-slider-input"
          min={0}
          max={last}
          step={1}
          value={index}
          aria-label={label}
          aria-valuetext={value_text}
          onChange={(event) => on_change(Number(event.target.value))}
          onKeyDown={on_key_down}
          onBlur={() => set_keyboard(false)}
        />
      </div>
    </div>
  );
};
