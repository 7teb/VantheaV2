import type { DiffLine } from "../../shared/tool-view.ts";

export type LineDiff = { added: number; removed: number; lines: DiffLine[] };

const context_lines = 3;

const max_cells = 4_000_000;

const max_output_lines = 2000;

const split_lines = (text: string | null): string[] => {
  const lines = text ? text.split(/\r?\n/) : [];
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
};

const context = (a: string[], i: number, j: number): DiffLine => ({ kind: "context", text: a[i], old_line: i + 1, new_line: j + 1 });

const removal = (a: string[], i: number): DiffLine => ({ kind: "remove", text: a[i], old_line: i + 1, new_line: null });

const addition = (b: string[], j: number): DiffLine => ({ kind: "add", text: b[j], old_line: null, new_line: j + 1 });

const middle_rows = (a: string[], b: string[], a_start: number, a_end: number, b_start: number, b_end: number): DiffLine[] => {
  const n = a_end - a_start;
  const m = b_end - b_start;
  const rows: DiffLine[] = [];
  if (n * m > max_cells) {
    for (let i = a_start; i < a_end; i += 1) {
      rows.push(removal(a, i));
    }
    for (let j = b_start; j < b_end; j += 1) {
      rows.push(addition(b, j));
    }
    return rows;
  }
  const width = m + 1;
  const lcs = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[a_start + i] === b[b_start + j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[a_start + i] === b[b_start + j]) {
      rows.push(context(a, a_start + i, b_start + j));
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      rows.push(removal(a, a_start + i));
      i += 1;
    } else {
      rows.push(addition(b, b_start + j));
      j += 1;
    }
  }
  for (; i < n; i += 1) {
    rows.push(removal(a, a_start + i));
  }
  for (; j < m; j += 1) {
    rows.push(addition(b, b_start + j));
  }
  return rows;
};

const gap: DiffLine = { kind: "gap", text: "", old_line: null, new_line: null };

const hunks = (rows: DiffLine[]): DiffLine[] => {
  const keep = new Uint8Array(rows.length);
  rows.forEach((row, index) => {
    if (row.kind !== "context") {
      keep.fill(1, Math.max(0, index - context_lines), Math.min(rows.length, index + context_lines + 1));
    }
  });
  const lines: DiffLine[] = [];
  let skipped = false;
  for (let index = 0; index < rows.length; index += 1) {
    if (!keep[index]) {
      skipped = true;
      continue;
    }
    if (lines.length >= max_output_lines) {
      lines.push(gap);
      return lines;
    }
    if (skipped) {
      lines.push(gap);
    }
    skipped = false;
    lines.push(rows[index]);
  }
  if (skipped && lines.length) {
    lines.push(gap);
  }
  return lines;
};

export const line_diff = (old_text: string | null, new_text: string | null): LineDiff => {
  const a = split_lines(old_text);
  const b = split_lines(new_text);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix += 1;
  }
  const rows: DiffLine[] = [];
  for (let index = 0; index < prefix; index += 1) {
    rows.push(context(a, index, index));
  }
  for (const row of middle_rows(a, b, prefix, a.length - suffix, prefix, b.length - suffix)) {
    rows.push(row);
  }
  for (let offset = suffix; offset > 0; offset -= 1) {
    rows.push(context(a, a.length - offset, b.length - offset));
  }
  const added = rows.filter((row) => row.kind === "add").length;
  const removed = rows.filter((row) => row.kind === "remove").length;
  return { added, removed, lines: hunks(rows) };
};
