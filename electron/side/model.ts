import type { SideModelRole } from "../../shared/models.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { complete } from "../model/complete.ts";
import type { ApiMessage } from "../model/types.ts";
import type { SideMessage, SideModelCall } from "../tools/types.ts";
import { noted_text, type SideReply } from "./reply.ts";

const to_api = (message: SideMessage): ApiMessage => ({ role: message.role, content: message.content });

export const side_complete = async (role: SideModelRole, messages: ApiMessage[], max_tokens: number | null, signal: AbortSignal, temperature = 0.2): Promise<SideReply> => {
  const catalog = await model_catalog();
  const model_id = catalog.side[role];
  const result = await complete({ model_id, messages, ...(max_tokens === null ? {} : { max_tokens }), temperature }, signal);
  if (result.meta.finish_reason === "length") {
    console.warn(`[side] ${role} output from ${model_id} ended at the provider's output limit after ${result.text.length} chars`);
  }
  return { text: result.text, finish_reason: result.meta.finish_reason };
};

export const side_model: SideModelCall = Object.assign(
  async (role: SideModelRole, messages: SideMessage[], max_tokens: number | null, signal: AbortSignal) => noted_text(await side_complete(role, messages.map(to_api), max_tokens, signal)),
  { model_id: async (role: SideModelRole) => (await model_catalog()).side[role] },
);
