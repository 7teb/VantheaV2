import type { TurnEvent } from "../../shared/events.ts";

export type Chime = "finished" | "attention";

export const chime_for = (event: TurnEvent): Chime | null => {
  switch (event.type) {
    case "end":
      return event.status === "stopped" || event.error?.kind === "app_closed" ? null : "finished";
    case "tool_approval":
      return "attention";
    case "tool_end":
      return event.view?.kind === "questions" ? "attention" : null;
    default:
      return null;
  }
};
