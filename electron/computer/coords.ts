import type { ComputerButton, ComputerShotRef } from "../../shared/tool-view.ts";
import { ToolArgumentError } from "../tools/types.ts";

export type Display = { id: string; x: number; y: number; width: number; height: number; primary: boolean };
export type Frame = { display: Display; width: number; height: number; ref: ComputerShotRef };
export type Point = { x: number; y: number };
export type InputAction =
  | ({ op: "click"; button: ComputerButton; count: number; modifiers: number[] } & Point)
  | ({ op: "move" } & Point)
  | ({ op: "scroll"; dx: number; dy: number } & Point)
  | ({ op: "drag"; to_x: number; to_y: number; button: ComputerButton } & Point)
  | { op: "type"; text: string }
  | { op: "key"; keys: number[] };

const modifiers = new Map([["ctrl", 17], ["control", 17], ["shift", 16], ["alt", 18], ["meta", 91], ["win", 91], ["super", 91]]);
const named_keys = new Map([["enter", 13], ["return", 13], ["escape", 27], ["esc", 27], ["tab", 9], ["space", 32], ["backspace", 8], ["delete", 46], ["insert", 45], ["home", 36], ["end", 35], ["pageup", 33], ["pagedown", 34], ["arrowleft", 37], ["left", 37], ["arrowup", 38], ["up", 38], ["arrowright", 39], ["right", 39], ["arrowdown", 40], ["down", 40]]);

export const read_modifiers = (value: unknown): { names: string[]; codes: number[] } => {
  if (value === undefined) return { names: [], codes: [] };
  if (!Array.isArray(value) || value.length > 4) throw new ToolArgumentError("modifiers must be a list of Control, Shift, Alt or Meta");
  const codes = value.map((entry) => typeof entry === "string" ? modifiers.get(entry.toLowerCase()) : undefined);
  if (codes.some((code) => code === undefined)) throw new ToolArgumentError("Unsupported modifier; use Control, Shift, Alt or Meta");
  const unique = [...new Set(codes as number[])];
  return { codes: unique, names: unique.map((code) => ({ 17: "Control", 16: "Shift", 18: "Alt", 91: "Meta" })[code] as string) };
};

export const parse_keys = (text: string): number[] => {
  const parts = text.split("+").map((part) => part.trim().toLowerCase());
  const last = parts.pop() ?? "";
  const before = read_modifiers(parts).codes;
  const key = named_keys.get(last) ?? (/^[a-z0-9]$/.test(last) ? last.toUpperCase().charCodeAt(0) : /^f([1-9]|1[0-2])$/.test(last) ? 111 + Number(last.slice(1)) : undefined);
  if (key === undefined) throw new ToolArgumentError("Unsupported key; use a letter, digit, F1-F12, Enter, Escape, Tab, Space, arrows, Home, End, PageUp, PageDown, Backspace, Delete or Insert, with optional Ctrl/Shift/Alt/Meta");
  return [...before, key];
};

export const map_point = (frame: Frame, point: Point) => {
  const x = Math.min(frame.width - 1, Math.max(0, Math.round(point.x)));
  const y = Math.min(frame.height - 1, Math.max(0, Math.round(point.y)));
  return {
    image: { x, y },
    real: { x: frame.display.x + Math.round(x * (frame.display.width - 1) / Math.max(1, frame.width - 1)), y: frame.display.y + Math.round(y * (frame.display.height - 1) / Math.max(1, frame.height - 1)) },
    clamped: x !== Math.round(point.x) || y !== Math.round(point.y),
  };
};

export const select_display = (displays: Display[], id: string | null): Display => {
  if (id === "all") {
    if (!displays.length) throw new Error("No displays are available");
    const x = Math.min(...displays.map((display) => display.x));
    const y = Math.min(...displays.map((display) => display.y));
    return { id, x, y, width: Math.max(...displays.map((display) => display.x + display.width)) - x, height: Math.max(...displays.map((display) => display.y + display.height)) - y, primary: false };
  }
  const display = id ? displays.find((entry) => entry.id === id) : displays.find((entry) => entry.primary) ?? displays[0];
  if (!display) throw new Error(`Display ${id ?? "primary"} is unavailable; available displays: ${displays.map((entry) => entry.id).join(", ")}`);
  return display;
};
