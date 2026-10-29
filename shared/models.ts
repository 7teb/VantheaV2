import { compact_fraction, type AssistantMessage, type Message } from "./chat.ts";
import { min_context_limit, type ModelContext } from "./settings.ts";

export type ModelRoute = { id: string; label: string; provider_order: string[] };

export type ProVariant = { id: string; label: string };

export const speed_tiers = ["fast", "ultrafast"] as const;

export type SpeedTier = (typeof speed_tiers)[number];

export type ModelChoice = { model: string; effort: string; pro: boolean; tier?: SpeedTier };

export const verbosity_levels = ["low", "medium", "high", "xhigh", "max"] as const;

export type Verbosity = (typeof verbosity_levels)[number];

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
  verbosity?: Verbosity;
  compact_at?: number;
  note?: string;
  fallback?: ModelRoute;
  pro?: ProVariant;
  tiers?: Partial<Record<SpeedTier, string>>;
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

export type SideModelRole = "title" | "overseer" | "vision" | "memory" | "reasoning_status" | "transcription" | "git_text";

export type SideModelEntry = { id: string; context_length: number; max_output: number };

export type ImageModelEntry = { id: string; label: string; quality: boolean };

export type ModelCatalog = {
  models: ModelEntry[];
  side: Record<SideModelRole, string>;
  side_models: SideModelEntry[];
  image_models: ImageModelEntry[];
};

export const pro_variant = (model: ModelEntry): ModelEntry => {
  const { pro, ...rest } = model;
  return pro ? { ...rest, id: pro.id, label: pro.label } : model;
};

export const with_pro = (model: ModelEntry, pro: boolean): ModelEntry => (pro ? pro_variant(model) : model);

const tier_names: Record<SpeedTier, string> = { fast: "Fast", ultrafast: "Ultrafast" };

export const with_tier = (model: ModelEntry, tier: SpeedTier | undefined): ModelEntry => {
  const route = tier ? model.tiers?.[tier] : undefined;
  return tier && route ? { ...model, label: `${model.label} ${tier_names[tier]}`, provider_order: [route] } : model;
};

export const with_choice = (model: ModelEntry, choice: Pick<ModelChoice, "pro" | "tier">): ModelEntry => with_tier(with_pro(model, choice.pro), choice.tier);

export const model_listing = (models: readonly ModelEntry[], id: string): { entry: ModelEntry; pro: boolean } | null => {
  const entry = models.find((model) => model.id === id || model.pro?.id === id);
  return entry ? { entry, pro: entry.id !== id } : null;
};

export const find_model = (catalog: ModelCatalog | null, id: string): ModelEntry | null => {
  const listed = model_listing(catalog?.models ?? [], id);
  return listed ? with_pro(listed.entry, listed.pro) : null;
};

export const message_choice = (catalog: ModelCatalog | null, messages: readonly Message[]): ModelChoice | null => {
  const last = messages.findLast((message): message is AssistantMessage => message.role === "assistant");
  const listed = last ? model_listing(catalog?.models ?? [], last.model) : null;
  return last && listed ? { model: listed.entry.id, effort: last.effort, pro: listed.pro } : null;
};

export const chat_choice = (stored: ModelChoice | undefined, messages: readonly Message[] | undefined, catalog: ModelCatalog | null, fallback: ModelChoice): ModelChoice =>
  stored ?? (messages ? message_choice(catalog, messages) : null) ?? fallback;
