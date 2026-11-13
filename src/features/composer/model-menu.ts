import { catalog_choice, with_choice, type ModelCatalog, type ModelChoice, type ModelEntry } from "../../../shared/models.ts";
import type { MenuSection } from "../../components/Menu.tsx";
import type { Translate } from "../../i18n/translate.ts";
import { effective_effort } from "../../state/models.ts";
import { effort_label } from "./composer-hooks.ts";

export type ChoiceView = { model: ModelEntry | null; effort: string };

export const choice_view = (catalog: ModelCatalog, stored: ModelChoice): ChoiceView => {
  const choice = catalog_choice(catalog.models, stored);
  const base = catalog.models.find((entry) => entry.id === choice.model) ?? null;
  return { model: base ? with_choice(base, choice) : null, effort: base ? effective_effort(base, choice.effort) : choice.effort };
};

export const with_model = (choice: ModelChoice, entry: ModelEntry): ModelChoice => ({ ...choice, model: entry.id, effort: effective_effort(entry, choice.effort) });

export const model_menu_sections = (t: Translate, catalog: ModelCatalog, choice: ModelChoice, on_choice: (choice: ModelChoice) => void): MenuSection[] => {
  const { model, effort } = choice_view(catalog, choice);
  const models_section: MenuSection = {
    id: "models",
    label: t("composer.model_model"),
    items: catalog.models.map((entry) => ({
      id: entry.id,
      label: entry.label,
      checked: entry.id === choice.model,
      on_select: () => on_choice(with_model(choice, entry)),
    })),
  };
  if (!model || model.efforts.length === 0) {
    return [models_section];
  }
  const efforts_section: MenuSection = {
    id: "efforts",
    label: t("composer.model_effort"),
    items: model.efforts.map((entry) => ({
      id: entry,
      label: effort_label(t, entry),
      checked: entry === effort,
      on_select: () => on_choice({ ...choice, effort: entry }),
    })),
  };
  return [models_section, efforts_section];
};
