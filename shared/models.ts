import { compact_fraction, type AssistantMessage, type Message } from "./chat.ts";
import { min_context_limit, type ModelContext } from "./settings.ts";

export type ModelRoute = { id: string; label: string; provider_order: string[] };

export type ProVariant = { id: string; label: string };

export const speed_tiers = ["fast", "ultrafast", "flex"] as const;

export type SpeedTier = (typeof speed_tiers)[number];

export type SpeedRoute = { provider_order: string[]; id?: string; max_output?: number; service_tier?: string };

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
  major?: string;
  vision: boolean;
  context_length: number;
  max_output: number;
  reasoning_passback: boolean;
  verbosity?: Verbosity;
  compact_at?: number;
  note?: string;
  fallback?: ModelRoute;
  pro?: ProVariant;
  tiers?: Partial<Record<SpeedTier, SpeedRoute>>;
  service_tier?: string;
  default_context?: ModelContext;
  claude_code?: string;
};

export const context_setting = (model: ModelEntry, stored: ModelContext | undefined): ModelContext | undefined => stored ?? model.default_context;

export const with_context_setting =(model: ModelEntry, setting: ModelContext | undefined): ModelEntry =>
  setting
    ? { ...model, context_length: setting.limit === null ? model.context_length : Math.min(setting.limit, model.context_length), compact_at: setting.compact_percent / 100 }
    : model;

export const compact_percent_of = (setting: ModelContext | undefined): number => setting?.compact_percent ?? Math.round(compact_fraction * 100);

export const with_compact_percent = (setting: ModelContext | undefined, percent: number): ModelContext => ({ limit: setting?.limit ?? null, compact_percent: percent });

export const with_context_limit = (model: ModelEntry, setting: ModelContext | undefined, limit: number | null): ModelContext => ({
  limit: limit === null || limit >= model.context_length ? null : Math.max(min_context_limit, limit),
  compact_percent: compact_percent_of(setting),
});

export type SideModelRole = "title" | "overseer" | "vision" | "reasoning_status" | "transcription" | "git_text";

export type SideModelEntry = { id: string; context_length: number; max_output: number };

export type ImageModelEntry = { id: string; label: string; quality: boolean };

export type ModelCatalog = {
  models: ModelEntry[];
  side: Record<SideModelRole, string>;
  side_models: SideModelEntry[];
  image_models: ImageModelEntry[];
  plan_ids?: string[];
  plan_tiers?: Record<string, SpeedTier[]>;
  pro_locked?: string[];
  claude_plan_ids?: string[];
};

export const pro_variant = (model: ModelEntry): ModelEntry => {
  const { pro, ...rest } = model;
  return pro ? { ...rest, id: pro.id, label: pro.label } : model;
};

export const with_pro = (model: ModelEntry, pro: boolean): ModelEntry => (pro ? pro_variant(model) : model);

const tier_names: Record<SpeedTier, string> = { fast: "Fast", ultrafast: "Ultrafast", flex: "Flex" };

export const with_tier = (model: ModelEntry, tier: SpeedTier | undefined): ModelEntry => {
  const route = tier ? model.tiers?.[tier] : undefined;
  if (!tier || !route) {
    return model;
  }

  return {
    ...model,
    id: route.id ?? model.id,
    label: `${model.label} ${tier_names[tier]}`,
    provider_order: route.provider_order,
    max_output: route.max_output ?? model.max_output,
    ...(route.service_tier ? { service_tier: route.service_tier } : {}),
  };
};

const flex_suffix = ":floor";

export const flex_base = (id: string): string | null => (id.endsWith(flex_suffix) ? id.slice(0, -flex_suffix.length) : null);

export const flex_id = (id: string): string => `${id}${flex_suffix}`;

export type PlanServing = Pick<ModelCatalog, "plan_ids" | "plan_tiers">;

const plan_service_tiers: Partial<Record<SpeedTier, string>> = { fast: "priority", ultrafast: "ultrafast" };

const plan_routes = (tiers: readonly SpeedTier[], provider_order: string[]): Partial<Record<SpeedTier, SpeedRoute>> =>
  Object.fromEntries(tiers.flatMap((tier) => (plan_service_tiers[tier] ? [[tier, { provider_order, service_tier: plan_service_tiers[tier] }]] : [])));

export const with_choice = (model: ModelEntry, choice: Pick<ModelChoice, "pro" | "tier">, plan?: PlanServing | null): ModelEntry => {
  const variant = with_pro(model, choice.pro);
  if (!plan?.plan_ids?.includes(variant.id)) {
    return with_tier(variant, choice.tier);
  }
  const { tiers, ...plan_variant } = variant;
  const offered = plan.plan_tiers?.[variant.id] ?? [];
  return with_tier(offered.length ? { ...plan_variant, tiers: plan_routes(offered, plan_variant.provider_order) } : plan_variant, choice.tier);
};

export type ModelListing = { entry: ModelEntry; pro: boolean; tier?: SpeedTier };

const tier_listing = (models: readonly ModelEntry[], id: string): ModelListing | null => {
  for (const entry of models) {
    const tier = speed_tiers.find((name) => entry.tiers?.[name]?.id === id);
    if (tier) {
      return { entry, pro: false, tier };
    }
  }

  return null;
};

export const model_listing = (models: readonly ModelEntry[], id: string): ModelListing | null => {
  const base = flex_base(id);
  const wanted = base ?? id;
  const entry = models.find((model) => model.id === wanted || model.pro?.id === wanted);
  if (!entry) {
    return base ? null : tier_listing(models, id);
  }

  if (base && !entry.tiers?.flex) {
    return null;
  }

  return { entry, pro: entry.id !== wanted, ...(base ? { tier: "flex" as const } : {}) };
};

export const listed_model = (listed: ModelListing, plan?: PlanServing | null): ModelEntry => with_choice(listed.entry, listed, plan);

export const catalog_choice = (models: readonly ModelEntry[], choice: ModelChoice): ModelChoice => {
  if (models.some((entry) => entry.id === choice.model)) {
    return choice;
  }

  const listed = model_listing(models, choice.model);
  if (!listed) {
    return choice;
  }

  return { ...choice, model: listed.entry.id, pro: choice.pro || listed.pro, ...(listed.tier ? { tier: listed.tier } : {}) };
};

export const find_model = (catalog: ModelCatalog | null, id: string): ModelEntry | null => {
  const listed = model_listing(catalog?.models ?? [], id);
  return listed ? listed_model(listed, catalog) : null;
};

export const default_model_id = "deepseek/deepseek-v4.1-flash-1017";

export const fallback_model = (models: readonly ModelEntry[]): ModelEntry => models.find((model) => model.id === default_model_id) ?? models[0];

export const message_choice = (catalog: ModelCatalog | null, messages: readonly Message[]): ModelChoice | null => {
  const last = messages.findLast((message): message is AssistantMessage => message.role === "assistant");
  const listed = last ? model_listing(catalog?.models ?? [], last.model) : null;
  return last && listed ? { model: listed.entry.id, effort: last.effort, pro: listed.pro, ...(listed.tier ? { tier: listed.tier } : {}) } : null;
};

export const chat_choice = (stored: ModelChoice | undefined, messages: readonly Message[] | undefined, catalog: ModelCatalog | null, fallback: ModelChoice): ModelChoice =>
  catalog_choice(catalog?.models ?? [], stored ?? (messages ? message_choice(catalog, messages) : null) ?? fallback);
