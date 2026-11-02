import type { Message } from "../../shared/chat.ts";
import { find_model, flex_base, type ModelCatalog, type ModelEntry } from "../../shared/models.ts";
import type { TurnNote } from "./session.ts";

export const model_switch_content = (text: string): string => {
  const [before = "", after = ""] = text.split("\n");
  return [
    `The user switched this chat's model. The answers above, back to the previous model switch note if there is one, were written by ${before}.`,
    `From this message on the answers are written by you, ${after}.`,
    "Do not present the earlier answers of another model as your own work.",
  ].join(" ");
};

const named = (id: string, label: string | null) => (label ? `${label} (${id})` : id);

export const model_switch_note = (history: Message[], model: ModelEntry, catalog: ModelCatalog | null): TurnNote | null => {
  const previous = history.findLast((message) => message.role === "assistant");
  if (previous?.role !== "assistant" || !previous.model || (flex_base(previous.model) ?? previous.model) === model.id) {
    return null;
  }
  const text = `${named(previous.model, find_model(catalog, previous.model)?.label ?? null)}\n${named(model.id, model.label)}`;
  return { kind: "notice", notice: "model_switch", text, content: model_switch_content(text) };
};
