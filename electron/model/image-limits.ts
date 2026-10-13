import { edge_rule, type NativeSize } from "../../shared/image-fit.ts";
import { native_rules } from "../../shared/image-native.ts";
import type { ModelEntry } from "../../shared/models.ts";

export type EdgeRule = { min_images: number; max_edge: number };

export type ImageLimit = {
  max_images: number | null;
  max_request_bytes: number | null;
  max_encoded_bytes: number | null;
  max_decoded_bytes: number | null;
  edges: EdgeRule[];
};

type LimitRow = ImageLimit & { family: string; provider: string; sources: string[] };

const claude_vision = "https://platform.claude.com/docs/en/build-with-claude/vision";

const claude_overview = "https://platform.claude.com/docs/en/api/overview";

const claude_edges: EdgeRule[] = [
  { min_images: 1, max_edge: 8000 },
  { min_images: 21, max_edge: 2000 },
];

const no_limit: ImageLimit = { max_images: null, max_request_bytes: null, max_encoded_bytes: null, max_decoded_bytes: null, edges: [] };

const rows: LimitRow[] = [
  { ...no_limit, family: "anthropic", provider: "anthropic", max_images: 600, max_request_bytes: 32_000_000, max_encoded_bytes: 10_000_000, edges: claude_edges, sources: [claude_vision, claude_overview] },
  { ...no_limit, family: "anthropic", provider: "google-vertex", max_images: 600, max_request_bytes: 30_000_000, max_encoded_bytes: 5_000_000, edges: claude_edges, sources: [claude_vision, claude_overview] },
  { ...no_limit, family: "google", provider: "google-vertex", max_images: 3000, max_decoded_bytes: 7_000_000, sources: ["https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash"] },
  {
    ...no_limit,
    family: "google",
    provider: "google-ai-studio",
    max_images: 3600,
    max_request_bytes: 20_000_000,
    sources: ["https://ai.google.dev/gemini-api/docs/image-understanding", "https://ai.google.dev/gemini-api/docs/file-input-methods"],
  },
  { ...no_limit, family: "openai", provider: "openai", max_images: 1500, max_request_bytes: 512_000_000, sources: ["https://developers.openai.com/api/docs/guides/images-vision"] },
  {
    ...no_limit,
    family: "deepseek",
    provider: "deepseek",
    max_images: 600,
    max_request_bytes: 50_331_648,
    max_encoded_bytes: 33_554_432,
    edges: [
      { min_images: 1, max_edge: 8192 },
      { min_images: 15, max_edge: 4096 },
    ],
    sources: ["https://api-docs.deepseek.com/guides/vision"],
  },
  { ...no_limit, family: "moonshotai", provider: "moonshotai", max_request_bytes: 100_000_000, sources: ["https://platform.kimi.ai/docs/guide/use-kimi-vision-model"] },
  { ...no_limit, family: "qwen", provider: "alibaba", max_images: 250, max_request_bytes: 16_777_216, max_encoded_bytes: 20_000_000, sources: ["https://www.alibabacloud.com/help/en/model-studio/vision"] },
  {
    ...no_limit,
    family: "xiaomi",
    provider: "xiaomi",
    max_encoded_bytes: 50_000_000,
    sources: ["https://platform.xiaomimimo.com/#/docs/usage-guide/multimodal-understanding/image-understanding"],
  },
  { ...no_limit, family: "meta", provider: "meta", max_images: 50, max_encoded_bytes: 50_000_000, sources: ["https://dev.meta.ai/docs/image-understanding"] },
];

const first_segment = (value: string) => value.split("/")[0] ?? value;

const stricter = (left: number | null, right: number | null): number | null => {
  if (left === null) {
    return right;
  }
  return right === null ? left : Math.min(left, right);
};

const fold = (limit: ImageLimit, row: ImageLimit): ImageLimit => ({
  max_images: stricter(limit.max_images, row.max_images),
  max_request_bytes: stricter(limit.max_request_bytes, row.max_request_bytes),
  max_encoded_bytes: stricter(limit.max_encoded_bytes, row.max_encoded_bytes),
  max_decoded_bytes: stricter(limit.max_decoded_bytes, row.max_decoded_bytes),
  edges: [...limit.edges, ...row.edges],
});

const route_rows = (model_id: string, routes: string[]): LimitRow[] => {
  const family = first_segment(model_id);
  return rows.filter((row) => row.family === family && routes.some((route) => first_segment(route) === row.provider));
};

export const image_limit = (model: ModelEntry): ImageLimit => {
  const matched = [...route_rows(model.id, model.provider_order), ...(model.fallback ? route_rows(model.fallback.id, model.fallback.provider_order) : [])];
  return matched.reduce(fold, no_limit);
};

export const max_edge = (limit: ImageLimit, images: number): number | null =>
  limit.edges.filter((rule) => images >= rule.min_images).reduce<number | null>((edge, rule) => stricter(edge, rule.max_edge), null);

export const has_image_rules = (limit: ImageLimit): boolean =>
  limit.max_images !== null || limit.max_request_bytes !== null || limit.max_encoded_bytes !== null || limit.max_decoded_bytes !== null || limit.edges.length > 0;

export const image_rules = (model: ModelEntry, images: number): NativeSize[] => {
  const edge = max_edge(image_limit(model), images);
  return edge === null ? native_rules(model) : [...native_rules(model), edge_rule(edge)];
};
