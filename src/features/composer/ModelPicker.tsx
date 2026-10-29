import { useState } from "react";
import { with_choice } from "../../../shared/models.ts";
import { ChevronDownIcon, GaugeIcon } from "../../components/icons.tsx";
import { Menu, type MenuSection } from "../../components/Menu.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { use_t } from "../../i18n/index.ts";
import { set_choice } from "../../state/model-choice.ts";
import { effective_effort, models_store } from "../../state/models.ts";
import { use_store } from "../../state/use-store.ts";
import { effort_label, use_model_choice } from "./composer-hooks.ts";

export const ModelPicker = ({ chat_id }: { chat_id: string | null }) => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const models = use_store(models_store, (state) => state);
  const choice = use_model_choice(chat_id);

  if (models.status === "failed") {
    return <span className="composer-note">{t("composer.models_failed")}</span>;
  }
  if (!models.catalog || !choice) {
    return <Skeleton width={128} height="var(--size-control)" radius={9} />;
  }

  const catalog = models.catalog;
  const base = catalog.models.find((entry) => entry.id === choice.model) ?? null;
  const model = base ? with_choice(base, choice) : null;
  const effort = base ? effective_effort(base, choice.effort) : choice.effort;

  const sections: MenuSection[] = [
    {
      id: "models",
      label: t("composer.model_model"),
      items: catalog.models.map((entry) => ({
        id: entry.id,
        label: entry.label,
        checked: entry.id === choice.model,
        on_select: () => void set_choice(chat_id, { ...choice, model: entry.id, effort: effective_effort(entry, choice.effort) }),
      })),
    },
  ];
  if (model && model.efforts.length > 0) {
    sections.push({
      id: "efforts",
      label: t("composer.model_effort"),
      items: model.efforts.map((entry) => ({
        id: entry,
        label: effort_label(t, entry),
        icon: <GaugeIcon size={15} />,
        checked: entry === effort,
        on_select: () => void set_choice(chat_id, { ...choice, effort: entry }),
      })),
    });
  }

  return (
    <>
      <button
        ref={set_anchor}
        type="button"
        className="composer-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("composer.model_select")}
        data-open={open}
        onClick={() => set_open(!open)}
      >
        <span className="composer-chip-label composer-chip-model">{model?.label ?? t("composer.model_fallback")}</span>
        {model && model.efforts.length > 0 && (
          <span className="composer-chip-hint" data-effort={effort}>
            {effort_label(t, effort)}
          </span>
        )}
        <ChevronDownIcon size={14} className="composer-chip-chevron" />
      </button>
      <Menu
        open={open}
        anchor={anchor}
        label={t("composer.model_select")}
        sections={sections}
        on_close={() => set_open(false)}
        placement="top-start"
        min_width={260}
        className="composer-menu"
      />
    </>
  );
};
