import { useState } from "react";
import type { ModelChoice } from "../../../shared/models.ts";
import { class_names } from "../../components/class-names.ts";
import { ChevronDownIcon } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { use_t } from "../../i18n/index.ts";
import { models_store } from "../../state/models.ts";
import { use_store } from "../../state/use-store.ts";
import { effort_label } from "../composer/composer-hooks.ts";
import { choice_view, model_menu_sections } from "../composer/model-menu.ts";

type ModelFieldProps = { choice: ModelChoice; label: string; on_change: (choice: ModelChoice) => void };

export const ModelField = ({ choice, label, on_change }: ModelFieldProps) => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const catalog = use_store(models_store, (state) => state.catalog);
  const shown = catalog ? choice_view(catalog, choice) : null;
  const efforts = shown?.model ? shown.model.efforts.length > 0 : false;

  return (
    <>
      <button
        ref={set_anchor}
        type="button"
        className={class_names("select", "select-control", "scheduled-select", open && "is-open")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={catalog === null}
        onClick={() => set_open((was_open) => !was_open)}
      >
        <span className="select-value scheduled-model-value">
          <span className="scheduled-model-name">{shown?.model?.label ?? choice.model}</span>
          {efforts && shown && <span className="scheduled-model-effort">{effort_label(t, shown.effort)}</span>}
        </span>
        <ChevronDownIcon className="select-chevron" />
      </button>
      {catalog && (
        <Menu
          open={open}
          anchor={anchor}
          label={label}
          sections={model_menu_sections(t, catalog, choice, on_change)}
          on_close={() => set_open(false)}
          placement="bottom-start"
          min_width={260}
        />
      )}
    </>
  );
};
