import { with_context_setting, type ModelEntry } from "../../shared/models.ts";
import { get_settings } from "./store.ts";

export const context_model = (model: ModelEntry): ModelEntry => with_context_setting(model, get_settings().model_context[model.id]);
