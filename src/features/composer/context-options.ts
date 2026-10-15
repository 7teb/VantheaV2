import { compact_percent_of, with_context_setting, type ModelEntry } from "../../../shared/models.ts";
import { min_context_limit, type ModelContext } from "../../../shared/settings.ts";
import { compact_tokens } from "../../components/token-count.ts";
import type { Translate } from "../../i18n/translate.ts";
import type { CommandOption } from "./command-menu.ts";

export type ContextOption = { id: string; label: string; hint: string; selected: boolean };

export type CompactOption = ContextOption & { percent: number };

export type LimitOption = ContextOption & { limit: number | null };

const compact_percents = [50, 60, 70, 80, 90, 95];

const limit_presets = [1_000_000, 400_000, 272_000, 200_000, 128_000, 64_000, 32_000];

const chosen_limit = (model: ModelEntry, setting: ModelContext | undefined): number | null => {
  const limit = setting?.limit ?? null;
  return limit !== null && limit < model.context_length ? limit : null;
};

const with_current = (values: number[], current: number | null): number[] => (current === null || values.includes(current) ? values : [...values, current]);

export const auto_compact_options = (t: Translate, model: ModelEntry, setting: ModelContext | undefined): CompactOption[] => {
  const current = compact_percent_of(setting);
  const limit = with_context_setting(model, setting).context_length;
  return with_current(compact_percents, current)
    .toSorted((a, b) => a - b)
    .map((percent) => ({
      id: `compact:${percent}`,
      percent,
      label: t("context.compact_percent", { percent }),
      hint: t("context.compact_hint", { tokens: compact_tokens(Math.round((limit * percent) / 100)) }),
      selected: percent === current,
    }));
};

export const context_limit_options = (t: Translate, model: ModelEntry, setting: ModelContext | undefined): LimitOption[] => {
  const current = chosen_limit(model, setting);
  const presets = with_current(
    limit_presets.filter((limit) => limit >= min_context_limit && limit < model.context_length),
    current,
  ).toSorted((a, b) => b - a);
  return [
    { id: "limit:max", limit: null, label: t("context.limit_max"), hint: t("context.limit_tokens", { n: compact_tokens(model.context_length) }), selected: current === null },
    ...presets.map((limit) => ({ id: `limit:${limit}`, limit, label: t("context.limit_tokens", { n: compact_tokens(limit) }), hint: "", selected: limit === current })),
  ];
};

export const chosen_hint = (t: Translate, model: ModelEntry, options: ContextOption[]): string | null => {
  const chosen = options.find((option) => option.selected);
  return chosen ? t("commands.model_value", { value: chosen.label, model: model.label }) : null;
};

export const command_options = <O extends ContextOption>(options: O[], apply: (option: O) => Promise<void>): CommandOption[] =>
  options.map((option) => ({ id: option.id, label: option.label, hint: option.hint, checked: option.selected, run: () => apply(option) }));
