export const estimate_tokens = (text: string): number => {
  const value = text ?? "";
  const non_ascii = Buffer.byteLength(value, "utf8") - value.length;
  return Math.ceil(value.length / 4 + non_ascii / 2);
};

export const result_cap_tokens = 25000;

export const token_prefix = (text: string, max_tokens: number): string => {
  if (estimate_tokens(text) <= max_tokens) {
    return text;
  }
  let kept = text.slice(0, max_tokens * 4);
  while (kept.length > 2000 && estimate_tokens(kept) > max_tokens) {
    kept = kept.slice(0, Math.floor(kept.length * 0.85));
  }
  let low = 0;
  let high = kept.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimate_tokens(kept.slice(0, middle)) <= max_tokens) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return kept.slice(0, low);
};

export const cap_text = (text: string, max_tokens: number): string => {
  const kept = token_prefix(text, max_tokens);
  if (kept.length === text.length) {
    return text;
  }
  return `${kept}\n[truncated: ${text.length - kept.length} chars over the ${max_tokens}-token cap]`;
};
