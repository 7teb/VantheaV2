import { find_model } from "../../shared/models.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { review_completion } from "../model/review-call.ts";
import type { ReviewModelCall } from "../tools/types.ts";

const overseer_room = async (): Promise<number | null> => {
  const catalog = await model_catalog();
  const model = find_model(catalog, catalog.side.overseer);
  if (!model) {
    console.warn(`[review] review model ${catalog.side.overseer} is not in the model catalog, its context window is unknown and the default request cap applies`);
    return null;
  }
  return model.context_length - model.max_output;
};

export const review_call: ReviewModelCall = Object.assign(async (call: Parameters<ReviewModelCall>[0], signal: AbortSignal) => review_completion((await model_catalog()).side.overseer, call, signal), {
  prompt_room: overseer_room,
});
