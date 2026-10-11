import { model_catalog } from "../model/catalog-file.ts";
import { review_completion } from "../model/review-call.ts";
import type { ReviewModelCall } from "../tools/types.ts";

export const review_call: ReviewModelCall = async (call, signal) => review_completion((await model_catalog()).side.overseer, call, signal);
