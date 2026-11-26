import type { AccountModel } from "../../shared/chatgpt.ts";
import { pro_variant, type ModelEntry, type SpeedTier } from "../../shared/models.ts";
import { major_effort, plan_eligible, plan_served, plan_slug, type PlanSide, type PlanSideRole } from "../model/catalog.ts";

export type PlanModels = { models: ModelEntry[]; plan_ids: string[]; plan_tiers: Record<string, SpeedTier[]>; pro_locked: string[]; side_pool: ModelEntry[] };

export type SidePick = { model_id: string; effort: string };

const pro_on_plan = (entry: ModelEntry, account: readonly AccountModel[] | null): boolean =>
  entry.pro !== undefined && account !== null && plan_served(pro_variant(entry), account);

const pro_locked = (entry: ModelEntry, account: readonly AccountModel[] | null): boolean =>
  entry.pro !== undefined && plan_served(entry, account) && !pro_on_plan(entry, account);

const plan_entry = (entry: ModelEntry, account: readonly AccountModel[] | null): ModelEntry => {
  const context_window = account?.find((model) => model.slug === plan_slug(entry.id))?.context_window ?? null;
  const sized = context_window === null ? entry : { ...entry, context_length: Math.min(entry.context_length, context_window) };
  if (!pro_locked(entry, account)) {
    return sized;
  }
  const { pro, ...without_pro } = sized;
  return without_pro;
};

const served_ids = (entry: ModelEntry, account: readonly AccountModel[] | null): string[] => [
  ...(plan_served(entry, account) ? [entry.id] : []),
  ...(pro_on_plan(entry, account) ? [pro_variant(entry).id] : []),
];

const listed_tiers: Record<string, SpeedTier> = { priority: "fast", fast: "fast", ultrafast: "ultrafast" };

const account_tiers = (id: string, account: readonly AccountModel[] | null): SpeedTier[] => {
  const listed = account?.find((model) => model.slug === plan_slug(id))?.service_tiers ?? [];
  return [...new Set(listed.flatMap((tier) => (listed_tiers[tier] ? [listed_tiers[tier]] : [])))];
};

export const plan_models = (catalog: readonly ModelEntry[], account: readonly AccountModel[] | null): PlanModels => {
  const models = catalog.map((entry) => (plan_served(entry, account) ? plan_entry(entry, account) : entry));
  const plan_ids = catalog.flatMap((entry) => served_ids(entry, account));
  const plan_tiers = Object.fromEntries(plan_ids.flatMap((id) => {
    const tiers = account_tiers(id, account);
    return tiers.length ? [[id, tiers]] : [];
  }));
  const locked = catalog.filter((entry) => pro_locked(entry, account)).map((entry) => entry.id);
  const eligible = models.filter((entry) => plan_eligible(entry));
  const by_slug = new Map(eligible.map((entry) => [plan_slug(entry.id), entry] as const));
  const listed = (account ?? []).flatMap((model) => {
    const entry = by_slug.get(model.slug);
    return entry ? [entry] : [];
  });
  return { models, plan_ids, plan_tiers, pro_locked: locked, side_pool: listed.length ? listed : eligible };
};

export const unlisted_slugs = (models: readonly ModelEntry[], account: readonly AccountModel[] | null): string[] => {
  const known = new Set(models.filter((entry) => plan_eligible(entry)).flatMap((entry) => [plan_slug(entry.id), ...(entry.pro ? [plan_slug(entry.pro.id)] : [])]));
  return (account ?? []).map((model) => model.slug).filter((slug) => !known.has(slug));
};

const lowest_effort = (model: ModelEntry): string => model.efforts.find((effort) => effort !== major_effort) ?? "";

export const pick_plan_side = (role: PlanSideRole, plan_side: PlanSide, pool: readonly ModelEntry[], account: readonly AccountModel[] | null): SidePick => {
  const configured = plan_side[role];
  const configured_slug = plan_slug(configured.model);
  const replacement = (role === "vision" ? pool.find((model) => model.vision) : undefined) ?? pool[0];
  if (account === null || account.some((model) => model.slug === configured_slug) || !replacement) {
    return { model_id: configured.model, effort: configured.effort };
  }
  return { model_id: replacement.id, effort: lowest_effort(replacement) };
};
