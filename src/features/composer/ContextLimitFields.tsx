import { useState } from "react";
import { compact_fraction } from "../../../shared/chat.ts";
import { with_context_setting, type ModelEntry } from "../../../shared/models.ts";
import { min_context_limit, type ModelContext } from "../../../shared/settings.ts";
import { compact_tokens } from "../../components/ContextRing.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { Slider } from "../../components/Slider.tsx";
import { TextField } from "../../components/TextField.tsx";
import { use_t } from "../../i18n/index.ts";
import "./ContextLimitFields.css";

const presets = [272_000, 128_000];

type Choice = "max" | "custom" | `${number}`;

type ContextLimitFieldsProps = { model: ModelEntry; setting: ModelContext | undefined; on_change: (next: ModelContext) => void };

export const ContextLimitFields = ({ model, setting, on_change }: ContextLimitFieldsProps) => {
  const t = use_t();
  const limit = with_context_setting(model, setting).context_length;
  const percent = setting?.compact_percent ?? Math.round(compact_fraction * 100);
  const shown_presets = presets.filter((preset) => preset < model.context_length);
  const [custom, set_custom] = useState(() => setting?.limit !== null && setting?.limit !== undefined && !shown_presets.includes(setting.limit));
  const [draft, set_draft] = useState(String(limit));
  const choice: Choice = custom ? "custom" : setting?.limit === null || setting?.limit === undefined ? "max" : `${setting.limit}`;
  const save = (next_limit: number | null) => on_change({ limit: next_limit, compact_percent: percent });

  const choose = (next: Choice) => {
    if (next === "custom") {
      set_custom(true);
      set_draft(String(limit));
      return;
    }
    set_custom(false);
    save(next === "max" ? null : Number(next));
  };

  const commit = () => {
    const value = Number(draft.replace(/\D/g, ""));
    if (!value) {
      set_draft(String(limit));
      return;
    }
    const clamped = Math.max(min_context_limit, Math.min(value, model.context_length));
    set_draft(String(clamped));
    save(clamped === model.context_length ? null : clamped);
  };

  return (
    <div className="context-limits">
      <div className="context-limits-model">{model.label}</div>
      <div className="context-limits-field">
        <div className="context-limits-head">
          <span>{t("context.limit")}</span>
          <span className="context-limits-value">{t("context.limit_tokens", { n: compact_tokens(limit) })}</span>
        </div>
        <Segmented<Choice>
          label={t("context.limit")}
          value={choice}
          on_change={choose}
          options={[
            { id: "max", label: t("context.limit_max") },
            ...shown_presets.map((preset) => ({ id: `${preset}` as Choice, label: compact_tokens(preset) })),
            { id: "custom", label: t("context.limit_custom") },
          ]}
        />
        {custom && (
          <TextField
            value={draft}
            on_change={set_draft}
            inputMode="numeric"
            aria-label={t("context.limit")}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commit();
              }
            }}
          />
        )}
      </div>
      <div className="context-limits-field">
        <div className="context-limits-head">
          <span>{t("context.compact_at")}</span>
          <span className="context-limits-value">{t("context.compact_at_value", { percent, tokens: compact_tokens(Math.round((limit * percent) / 100)) })}</span>
        </div>
        <Slider
          value={percent}
          min={50}
          max={95}
          step={5}
          label={t("context.compact_at")}
          on_change={(next) => on_change({ limit: setting?.limit ?? null, compact_percent: next })}
        />
      </div>
    </div>
  );
};
