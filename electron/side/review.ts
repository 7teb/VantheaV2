import { side_choice, side_room } from "../billing/side.ts";
import { review_completion, review_limits } from "../model/review-call.ts";
import type { ReviewModelCall } from "../tools/types.ts";

const overseer_room = async (): Promise<number | null> => {
  const room = await side_room("overseer");
  return room ? room.context_length - room.max_output : null;
};

const overseer_call = async (call: Parameters<ReviewModelCall>[0], signal: AbortSignal) => {
  const choice = await side_choice("overseer");
  return review_completion(choice.model_id, call, signal, review_limits, choice.effort ?? undefined);
};

export const review_call: ReviewModelCall = Object.assign(overseer_call, { prompt_room: overseer_room });
