export type Replacement = { updated: string; replaced: number; flexible: boolean };

const escape_regex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const flexible_pattern = (value: string) =>
  (value.match(/\s+|\S+/g) ?? []).map((token) => (/^\s+$/.test(token) ? "\\s+" : escape_regex(token))).join("");

const crlf_replacement = (original: string, replacement: string, lf_matched: boolean) =>
  original.includes("\r\n") && !lf_matched && replacement.includes("\n") && !replacement.includes("\r")
    ? replacement.replace(/\n/g, "\r\n")
    : replacement;

const not_found =
  "old_string was not found in the file, even allowing for differences in whitespace, indentation and line endings. Read the exact region again with read_file (start_line and limit) and copy the text verbatim, or pick a shorter unique anchor.";

export const apply_replacement = (original: string, old_string: string, new_string: string, expected: number): Replacement => {
  const parts = original.split(old_string);
  const exact = parts.length - 1;
  if (exact === expected) {
    const replacement = crlf_replacement(original, new_string, old_string.includes("\n"));
    return { updated: parts.join(replacement), replaced: exact, flexible: false };
  }
  if (exact > 0) {
    throw new Error(
      `old_string occurs ${exact} times but expected_replacements is ${expected}; include more surrounding lines so it is unique, or pass expected_replacements ${exact} to replace every occurrence`,
    );
  }
  if (!old_string.trim()) {
    throw new Error("old_string was not found, and it contains only whitespace, so no whitespace-flexible match was tried");
  }
  const pattern = new RegExp(flexible_pattern(old_string), "g");
  const count = original.match(pattern)?.length ?? 0;
  if (count === 0) {
    throw new Error(not_found);
  }
  if (count !== expected) {
    throw new Error(
      `old_string is not an exact match, and its whitespace-flexible form occurs ${count} times but expected_replacements is ${expected}; make old_string longer and more specific`,
    );
  }
  const replacement = crlf_replacement(original, new_string, false);
  return { updated: original.replace(pattern, () => replacement), replaced: count, flexible: true };
};
