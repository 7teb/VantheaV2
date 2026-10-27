const review_draft = /^\s*\/review(?:\s+#?(\d{1,9}))?\s*$/;

export const parse_review_command = (text: string): { pr: number | null } | null => {
  const match = review_draft.exec(text);
  if (!match) {
    return null;
  }
  if (match[1] === undefined) {
    return { pr: null };
  }
  const pr = Number(match[1]);
  return pr >= 1 ? { pr } : null;
};
