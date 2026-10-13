import type { ModelContext } from "./settings.ts";

export type ModelRoute = { id: string; label: string; provider_order: string[] };

export type ModelEntry = {
  id: string;
  label: string;
  provider: string;
  provider_order: string[];
  efforts: string[];
  default_effort: string;
  vision: boolean;
  context_length: number;
  max_output: number;
  reasoning_passback: boolean;
  compact_at?: number;
  note?: string;
  fallback?: ModelRoute;
};

export const with_context_setting = (model: ModelEntry, setting: ModelContext | undefined): ModelEntry =>
  setting
    ? { ...model, context_length: setting.limit === null ? model.context_length : Math.min(setting.limit, model.context_length), compact_at: setting.compact_percent / 100 }
    : model;

export type SideModelRole = "title" | "overseer" | "vision" | "web_answer" | "memory";

export type ImageModelEntry = { id: string; label: string; quality: boolean };

export type ModelCatalog = {
  models: ModelEntry[];
  side: Record<SideModelRole, string>;
  image_models: ImageModelEntry[];
};
