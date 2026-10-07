import type { ModelCatalog, ModelEntry } from "../../shared/models.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";
import { settings_store, update_settings } from "./settings.ts";

export type ModelsState = { status: "loading" | "ready" | "failed"; catalog: ModelCatalog | null };

export const models_store = create_store<ModelsState>({ status: "loading", catalog: null });

const load_models = async () => {
  models_store.set({ status: "loading", catalog: models_store.get().catalog });
  try {
    models_store.set({ status: "ready", catalog: await api.invoke("models:catalog") });
  } catch (error) {
    console.error("[models] models:catalog failed", error);
    models_store.set({ status: "failed", catalog: null });
  }
};

export const find_model = (catalog: ModelCatalog | null, id: string): ModelEntry | null =>
  catalog?.models.find((model) => model.id === id) ?? null;

export const effective_effort = (model: ModelEntry, effort: string) => (model.efforts.includes(effort) ? effort : model.default_effort);

export const select_model = (model: ModelEntry) => {
  const effort = settings_store.get()?.effort ?? model.default_effort;
  void update_settings({ model: model.id, effort: effective_effort(model, effort) });
};

const replace_unknown_model = () => {
  const { catalog } = models_store.get();
  const settings = settings_store.get();
  const fallback = catalog?.models[0];
  if (!settings || !fallback || find_model(catalog, settings.model)) {
    return;
  }
  select_model(fallback);
};

export const init_models = (): (() => void) => {
  const stop_models = models_store.subscribe(replace_unknown_model);
  const stop_settings = settings_store.subscribe(replace_unknown_model);
  void load_models();
  return () => {
    stop_models();
    stop_settings();
  };
};
