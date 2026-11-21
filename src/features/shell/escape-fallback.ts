import { yields_to_focus, type FocusTarget } from "./shortcut-targets.ts";

export type EscapeContext = {
  consumed: boolean;
  focus: FocusTarget;
  dictating: boolean;
  busy: boolean;
};

export type EscapeFallback = "cancel_dictation" | "stop_turn";

export const escape_fallback = ({ consumed, focus, dictating, busy }: EscapeContext): EscapeFallback | null => {
  if (consumed || focus === "terminal") {
    return null;
  }
  if (dictating) {
    return "cancel_dictation";
  }
  return busy && !yields_to_focus("stop_turn", focus) ? "stop_turn" : null;
};
