export const visual_tool_name = "visualize";

export type VisualVar = { name: string; use: string };

export const visual_vars: readonly VisualVar[] = [
  { name: "--vx-text", use: "main text, values, headings" },
  { name: "--vx-text-secondary", use: "labels and secondary text" },
  { name: "--vx-text-tertiary", use: "captions, axis ticks, hints, units" },
  { name: "--vx-surface", use: "background of a card or panel when the content is grouped into one" },
  { name: "--vx-surface-raised", use: "controls and chips on top of a card" },
  { name: "--vx-fill", use: "subtle fills: tracks, inactive bars, table row hover" },
  { name: "--vx-fill-strong", use: "selected or pressed fills" },
  { name: "--vx-border", use: "card and control borders" },
  { name: "--vx-divider", use: "thin separators between rows" },
  { name: "--vx-code-bg", use: "background of inline code and code blocks" },
  { name: "--vx-accent", use: "the one highlight color: focus, active step, primary series" },
  { name: "--vx-positive", use: "success, done, under budget" },
  { name: "--vx-warning", use: "warnings, medium priority" },
  { name: "--vx-danger", use: "errors, high priority, over budget" },
  { name: "--vx-series-1", use: "categorical data color 1" },
  { name: "--vx-series-2", use: "categorical data color 2" },
  { name: "--vx-series-3", use: "categorical data color 3" },
  { name: "--vx-series-4", use: "categorical data color 4" },
  { name: "--vx-series-5", use: "categorical data color 5" },
  { name: "--vx-font", use: "UI and prose font family" },
  { name: "--vx-mono", use: "code and hex values font family" },
  { name: "--vx-size-caption", use: "small text" },
  { name: "--vx-size-body", use: "body text" },
  { name: "--vx-size-title", use: "section titles" },
  { name: "--vx-radius", use: "card corner radius" },
  { name: "--vx-radius-control", use: "button and input corner radius" },
];
