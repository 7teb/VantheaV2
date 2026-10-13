import { default_native, type NativeSize } from "./image-fit.ts";
import type { ModelEntry } from "./models.ts";

type NativeRow = { family: string; native: NativeSize; sources: string[] };

const rows: NativeRow[] = [
  {
    family: "anthropic",
    native: { max_edge: 2576, patch: 28, max_patches: 4784 },
    sources: ["https://platform.claude.com/docs/en/build-with-claude/vision", "https://platform.claude.com/docs/en/build-with-claude/vision-coordinates"],
  },
  { family: "qwen", native: { max_edge: 7680, patch: 32, max_patches: 2560 }, sources: ["https://www.alibabacloud.com/help/en/model-studio/vision"] },
  { family: "deepseek", native: { max_edge: 4096, patch: 1, max_patches: 1_690_000 }, sources: ["https://api-docs.deepseek.com/guides/vision"] },
];

const family_of = (model_id: string) => model_id.split("/")[0] ?? model_id;

export const native_size = (model_id: string): NativeSize => rows.find((row) => row.family === family_of(model_id))?.native ?? default_native;

export const native_rules = (model: ModelEntry): NativeSize[] => [model.id, ...(model.fallback ? [model.fallback.id] : [])].map(native_size);

const pixel_budget = (native: NativeSize) => native.max_patches * native.patch * native.patch;

const known = [default_native, ...rows.map((row) => row.native)];

export const largest_native: NativeSize = {
  max_edge: Math.max(...known.map((native) => native.max_edge)),
  patch: 1,
  max_patches: Math.max(...known.map(pixel_budget)),
};
