import { compact_fraction } from "./chat.ts";
import { min_context_limit, type ModelContext } from "./settings.ts";

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

export const compact_percent_of = (setting: ModelContext | undefined): number => setting?.compact_percent ?? Math.round(compact_fraction * 100);

export const with_compact_percent = (setting: ModelContext | undefined, percent: number): ModelContext => ({ limit: setting?.limit ?? null, compact_percent: percent });

export const with_context_limit = (model: ModelEntry, setting: ModelContext | undefined, limit: number | null): ModelContext => ({
  limit: limit === null || limit >= model.context_length ? null : Math.max(min_context_limit, limit),
  compact_percent: compact_percent_of(setting),
});

export type SideModelRole = "title" | "overseer" | "vision" | "web_answer" | "memory" | "reasoning_status";

export type ImageModelEntry = { id: string; label: string; quality: boolean };

export type ModelCatalog = {
  models: ModelEntry[];
  side: Record<SideModelRole, string>;
  image_models: ImageModelEntry[];
};
