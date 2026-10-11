export type DraftFields = { text: string; before: string | null };

export const draft_tools = new Map<string, DraftFields>([
  ["write_file", { text: "content", before: null }],
  ["replace_in_file", { text: "new_string", before: "old_string" }],
]);

const count_breaks = (text: string): number => {
  let count = 0;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    count += 1;
  }
  return count;
};

export const lines_after = (lines: number, delta: string): number => (delta ? Math.max(lines, 1) + count_breaks(delta) : lines);
