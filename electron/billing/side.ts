import { find_model, type ModelEntry, type SideModelEntry, type SideModelRole } from "../../shared/models.ts";
import { side_window, type PlanSideRole } from "../model/catalog.ts";
import { model_catalog, plan_side_config } from "../model/catalog-file.ts";
import { context_model } from "../settings/model-context.ts";
import { get_settings } from "../settings/store.ts";
import { plan_lists, type PlanLists } from "./catalog.ts";
import { pick_plan_side, type SidePick } from "./offered.ts";

type SideChoice = { model_id: string; effort: string | null };

type RoomRole = "overseer" | "git_text";

const plan_pick = async (role: PlanSideRole, lists: PlanLists): Promise<SidePick> => pick_plan_side(role, await plan_side_config(), lists.side_pool, lists.account);

export const side_choice = async (role: SideModelRole): Promise<SideChoice> => {
  if (role === "transcription" || role === "reasoning_status" || get_settings().billing !== "chatgpt") {
    return { model_id: (await model_catalog()).side[role], effort: null };
  }
  return plan_pick(role, await plan_lists());
};

const window_of = (model: ModelEntry): SideModelEntry => ({ id: model.id, context_length: model.context_length, max_output: model.max_output });

const unknown_window = (role: RoomRole, id: string): null => {
  if (role === "git_text") {
    throw new Error(`model catalog: the git_text side model ${id} has no entry in models, so its context window is unknown`);
  }
  console.warn(`[review] review model ${id} is not in the model catalog, its context window is unknown and the default request cap applies`);
  return null;
};

const plan_window = async (role: RoomRole): Promise<SideModelEntry | null> => {
  const lists = await plan_lists();
  const { model_id } = await plan_pick(role, lists);
  const entry = lists.models.find((model) => model.id === model_id);
  return entry ? window_of(context_model(entry)) : unknown_window(role, model_id);
};

const api_window = async (role: RoomRole): Promise<SideModelEntry | null> => {
  const catalog = await model_catalog();
  if (role === "git_text") {
    return side_window(catalog, "git_text");
  }
  const model = find_model(catalog, catalog.side.overseer);
  return model ? window_of(model) : unknown_window(role, catalog.side.overseer);
};

export function side_room(role: "git_text"): Promise<SideModelEntry>;
export function side_room(role: "overseer"): Promise<SideModelEntry | null>;
export function side_room(role: RoomRole): Promise<SideModelEntry | null> {
  return get_settings().billing === "chatgpt" ? plan_window(role) : api_window(role);
}
