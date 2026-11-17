import { is_accent_color } from "../../shared/settings.ts";

const storage_key = "vx:accent";

export const apply_accent = (color: string) => {
  const style = document.documentElement.style;
  if (color) {
    style.setProperty("--accent", color);
    return;
  }
  style.removeProperty("--accent");
};

const remembered_accent = (): string => {
  try {
    const value = localStorage.getItem(storage_key) ?? "";
    return is_accent_color(value) ? value : "";
  } catch (error) {
    console.error("[accent] reading the remembered accent color failed", error);
    return "";
  }
};

let current = remembered_accent();

apply_accent(current);

export const set_accent = (color: string) => {
  apply_accent(color);
  if (color === current) {
    return;
  }
  current = color;
  try {
    if (color) {
      localStorage.setItem(storage_key, color);
    } else {
      localStorage.removeItem(storage_key);
    }
  } catch (error) {
    console.error(`[accent] remembering accent color ${color || "default"} failed`, error);
  }
};
