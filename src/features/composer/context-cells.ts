import type { ContextUsage } from "../../../shared/chat.ts";

export type ContextPart = "system" | "tools" | "messages" | "used";

export type ContextCell = ContextPart | "free";

export const cell_count = 100;

export const context_rows = (usage: ContextUsage): { part: ContextPart; tokens: number }[] =>
  usage.parts
    ? [
        { part: "system", tokens: usage.parts.system },
        { part: "tools", tokens: usage.parts.tools },
        { part: "messages", tokens: usage.parts.messages },
      ]
    : [{ part: "used", tokens: usage.used }];

export const context_cells = (usage: ContextUsage | null): ContextCell[] => {
  const cells: ContextCell[] = [];
  if (usage && usage.limit > 0) {
    for (const row of context_rows(usage)) {
      const share = row.tokens > 0 ? Math.max(1, Math.round((row.tokens / usage.limit) * cell_count)) : 0;
      for (let index = 0; index < share && cells.length < cell_count; index += 1) {
        cells.push(row.part);
      }
    }
  }
  while (cells.length < cell_count) {
    cells.push("free");
  }
  return cells;
};

export const share_text = (tokens: number, limit: number): string => {
  const percent = limit > 0 ? (tokens / limit) * 100 : 0;
  return `${percent > 0 && percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
};
