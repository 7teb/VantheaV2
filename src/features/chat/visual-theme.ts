import { visual_vars } from "../../../shared/visual.ts";

export const visual_tokens: Readonly<Record<string, string>> = {
  "--vx-text": "--text-primary",
  "--vx-text-secondary": "--text-secondary",
  "--vx-text-tertiary": "--text-tertiary",
  "--vx-surface": "--surface-card",
  "--vx-surface-raised": "--surface-on-raised",
  "--vx-fill": "--fill-hover",
  "--vx-fill-strong": "--raised-fill-active",
  "--vx-border": "--ring-card",
  "--vx-divider": "--divider",
  "--vx-code-bg": "--fill-code",
  "--vx-accent": "--ring-accent",
  "--vx-positive": "--text-positive",
  "--vx-warning": "--text-waiting",
  "--vx-danger": "--text-danger",
  "--vx-series-1": "--chart-series-1",
  "--vx-series-2": "--chart-series-2",
  "--vx-series-3": "--chart-series-3",
  "--vx-series-4": "--chart-series-4",
  "--vx-series-5": "--chart-series-5",
  "--vx-font": "--font-ui",
  "--vx-mono": "--font-mono",
  "--vx-size-caption": "--font-size-caption",
  "--vx-size-body": "--font-size-body",
  "--vx-size-title": "--font-size-title",
  "--vx-radius": "--radius-xl",
  "--vx-radius-control": "--radius-md",
};

export const visual_vars_css = (value_of: (token: string) => string): string =>
  visual_vars.map(({ name }) => `${name}: ${value_of(visual_tokens[name])};`).join(" ");
