import { useState } from "react";
import { ChevronDownIcon, GaugeIcon } from "../../components/icons.tsx";
import { Menu, type MenuSection } from "../../components/Menu.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { use_t } from "../../i18n/index.ts";
import { effective_effort, find_model, models_store, select_model } from "../../state/models.ts";
import { settings_store, update_settings } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";
import { effort_label } from "./composer-hooks.ts";

export const ModelPicker = () => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const models = use_store(models_store, (state) => state);
  const settings = use_store(settings_store, (state) => state);

  if (models.status === "failed") {
    return <span className="composer-note">{t("composer.models_failed")}</span>;
  }
  if (!models.catalog || !settings) {
    return <Skeleton width={128} height={32} radius={9} />;
  }

  const catalog = models.catalog;
  const model = find_model(catalog, settings.model);
  const effort = model ? effective_effort(model, settings.effort) : settings.effort;

  const sections: MenuSection[] = [
    {
      id: "models",
      label: t("composer.model_model"),
      items: catalog.models.map((entry) => ({
        id: entry.id,
        label: entry.label,
        hint: entry.provider,
        checked: entry.id === settings.model,
        on_select: () => select_model(entry),
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
        on_select: () => void update_settings({ effort: entry }),
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
        <span className="composer-chip-label">{model?.label ?? t("composer.model_fallback")}</span>
        {model && model.efforts.length > 0 && <span className="composer-chip-hint">{effort_label(t, effort)}</span>}
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
