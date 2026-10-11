export const prompt_cache_fields = (model_id: string): Record<string, unknown> =>
  model_id.startsWith("anthropic/") ? { cache_control: { type: "ephemeral" } } : {};

const single_marker_prefix_chars = 20000;

export const explicit_review_cache = (model_id: string): boolean => model_id.startsWith("openai/");

export const review_markers = (model_id: string, system: string, parts: { text: string; marker: boolean }[]): boolean[] => {
  if (explicit_review_cache(model_id)) {
    return parts.map((part) => part.marker);
  }
  const last = parts.findLastIndex((part) => part.marker);
  if (last < 0) {
    return parts.map(() => false);
  }
  const prefix = system.length + parts.slice(0, last + 1).reduce((total, part) => total + part.text.length, 0);
  return parts.map((_, index) => index === last && prefix >= single_marker_prefix_chars);
};
