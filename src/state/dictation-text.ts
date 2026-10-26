export type Inserted = { text: string; caret: number };

export const insert_dictation = (draft: string, caret: number | null, spoken: string): Inserted => {
  const at = caret === null ? draft.length : Math.min(Math.max(caret, 0), draft.length);
  const before = draft.slice(0, at);
  const after = draft.slice(at);
  const lead = before !== "" && !/\s$/.test(before) ? " " : "";
  const trail = after !== "" && !/^\s/.test(after) ? " " : "";
  return { text: `${before}${lead}${spoken}${trail}${after}`, caret: at + lead.length + spoken.length };
};
