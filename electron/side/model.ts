import type { SideModelRole } from "../../shared/models.ts";
import { side_choice } from "../billing/side.ts";
import { complete_model } from "../model/provider.ts";
import type { ApiMessage } from "../model/types.ts";
import type { SideMessage, SideModelCall } from "../tools/types.ts";
import { noted_text, type SideReply } from "./reply.ts";

const to_api = (message: SideMessage): ApiMessage => ({ role: message.role, content: message.content });

export type SideOptions = { temperature?: number; reasoning_effort?: string };

export const side_complete = async (
  role: SideModelRole,
  messages: ApiMessage[],
  max_tokens: number | null,
  signal: AbortSignal,
  { temperature = 0.2, reasoning_effort }: SideOptions = {},
): Promise<SideReply> => {
  const choice = await side_choice(role);
  const model_id = choice.model_id;
  const effort = choice.effort ?? reasoning_effort;
  const result = await complete_model(
    { model_id, messages, ...(max_tokens === null ? {} : { max_tokens }), temperature, ...(effort ? { reasoning_effort: effort } : {}) },
    signal,
  );
  if (result.meta.finish_reason === "length") {
    console.warn(`[side] ${role} output from ${model_id} ended at the provider's output limit after ${result.text.length} chars`);
  }
  return { text: result.text, finish_reason: result.meta.finish_reason };
};

export const side_model: SideModelCall = Object.assign(
  async (role: SideModelRole, messages: SideMessage[], max_tokens: number | null, signal: AbortSignal) => noted_text(await side_complete(role, messages.map(to_api), max_tokens, signal)),
  { model_id: async (role: SideModelRole) => (await side_choice(role)).model_id },
);
