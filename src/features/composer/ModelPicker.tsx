import { useState } from "react";
import { ChevronDownIcon } from "../../components/icons.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { use_t } from "../../i18n/index.ts";
import { set_choice } from "../../state/model-choice.ts";
import { models_store } from "../../state/models.ts";
import { use_store } from "../../state/use-store.ts";
import { effort_label, use_model_choice } from "./composer-hooks.ts";
import { choice_view } from "./model-menu.ts";
import { ModelMenu, type ModelMenuView } from "./ModelMenu.tsx";

export const ModelPicker = ({ chat_id }: { chat_id: string | null }) => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const [view, set_view] = useState<ModelMenuView>("effort");
  const models = use_store(models_store, (state) => state);
  const choice = use_model_choice(chat_id);

  if (models.status === "failed") {
    return <span className="composer-note">{t("composer.models_failed")}</span>;
  }
  if (!models.catalog || !choice) {
    return <Skeleton width={128} height="var(--size-control)" radius={9} />;
  }

  const { model, effort } = choice_view(models.catalog, choice);

  const toggle = () => {
    if (!open) {
      set_view("effort");
    }
    set_open(!open);
  };

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
        onClick={toggle}
      >
        <span className="composer-chip-label composer-chip-model">{model?.label ?? t("composer.model_fallback")}</span>
        {model && model.efforts.length > 0 && (
          <span className="composer-chip-hint" data-effort={effort}>
            {effort_label(t, effort)}
          </span>
        )}
        <ChevronDownIcon className="composer-chip-chevron" />
      </button>
      <ModelMenu
        open={open}
        anchor={anchor}
        catalog={models.catalog}
        choice={choice}
        view={view}
        on_view={set_view}
        on_choice={(next) => void set_choice(chat_id, next)}
        on_close={() => set_open(false)}
      />
    </>
  );
};
