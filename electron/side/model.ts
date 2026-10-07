import type { SideModelRole } from "../../shared/models.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { complete } from "../model/complete.ts";
import type { ApiMessage } from "../model/types.ts";
import type { SideMessage, SideModelCall } from "../tools/types.ts";

const to_api = (message: SideMessage): ApiMessage => ({ role: message.role, content: message.content });

export const side_complete = async (role: SideModelRole, messages: ApiMessage[], max_tokens: number, signal: AbortSignal): Promise<string> => {
  const catalog = await model_catalog();
  const model_id = catalog.side[role];
  const result = await complete({ model_id, messages, max_tokens, temperature: 0.2 }, signal);
  return result.text;
};

export const side_model: SideModelCall = Object.assign(
  (role: SideModelRole, messages: SideMessage[], max_tokens: number, signal: AbortSignal) => side_complete(role, messages.map(to_api), max_tokens, signal),
  { model_id: async (role: SideModelRole) => (await model_catalog()).side[role] },
);
