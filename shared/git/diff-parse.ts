import type { DiffLine } from "../tool-view.ts";

export type ParsedDiff = { binary: boolean; lines: DiffLine[] };

export type DiffBar = { kind: "added" | "modified" | "deleted"; line: number; count: number };

const hunk_head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const gap: DiffLine = { kind: "gap", text: "", old_line: null, new_line: null };

export const parse_unified_diff = (text: string): ParsedDiff => {
  const lines: DiffLine[] = [];
  let binary = false;
  let old_left = 0;
  let new_left = 0;
  let old_no = 0;
  let new_no = 0;
  let expected_old = 1;
  for (const raw of text.split("\n")) {
    const row = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const sign = row[0];
    if (sign === "\\") continue;
    if (old_left > 0 || new_left > 0) {
      if (sign === "+" && new_left > 0) {
        lines.push({ kind: "add", text: row.slice(1), old_line: null, new_line: new_no });
        new_no += 1;
        new_left -= 1;
        continue;
      }
      if (sign === "-" && old_left > 0) {
        lines.push({ kind: "remove", text: row.slice(1), old_line: old_no, new_line: null });
        old_no += 1;
        old_left -= 1;
        continue;
      }
      if ((sign === " " || sign === undefined) && old_left > 0 && new_left > 0) {
        lines.push({ kind: "context", text: row.slice(1), old_line: old_no, new_line: new_no });
        old_no += 1;
        new_no += 1;
        old_left -= 1;
        new_left -= 1;
        continue;
      }
      old_left = 0;
      new_left = 0;
    }
    const head = hunk_head.exec(row);
    if (head) {
      const old_start = Number(head[1]);
      const old_count = head[2] === undefined ? 1 : Number(head[2]);
      const new_start = Number(head[3]);
      const new_count = head[4] === undefined ? 1 : Number(head[4]);
      const first_old = old_count === 0 ? old_start + 1 : old_start;
      if (first_old > expected_old) lines.push(gap);
      expected_old = first_old + old_count;
      old_no = first_old;
      new_no = new_count === 0 ? new_start + 1 : new_start;
      old_left = old_count;
      new_left = new_count;
      continue;
    }
    if (/^Binary files .* differ$/.test(row) || row === "GIT binary patch") binary = true;
  }
  return { binary, lines };
};

export const diff_totals = (lines: DiffLine[]): { added: number; removed: number } => ({
  added: lines.filter((line) => line.kind === "add").length,
  removed: lines.filter((line) => line.kind === "remove").length,
});

export const diff_bars = (lines: DiffLine[]): DiffBar[] => {
  const bars: DiffBar[] = [];
  let last_new = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.kind !== "add" && line.kind !== "remove") {
      if (line.new_line !== null) last_new = line.new_line;
      index += 1;
      continue;
    }
    const block: DiffLine[] = [];
    while (index < lines.length && (lines[index].kind === "add" || lines[index].kind === "remove")) {
      block.push(lines[index]);
      index += 1;
    }
    const added = block.filter((entry) => entry.kind === "add");
    const first = added[0];
    if (first !== undefined && first.new_line !== null) {
      bars.push({ kind: added.length < block.length ? "modified" : "added", line: first.new_line, count: added.length });
      last_new = first.new_line + added.length - 1;
      continue;
    }
    const after = lines[index];
    bars.push({ kind: "deleted", line: after !== undefined && after.new_line !== null ? after.new_line : last_new + 1, count: 0 });
  }
  return bars;
};
