export type QuestionKeySource = "input" | "button" | "other";

type QuestionKeyAction =
  | { kind: "choose"; index: number }
  | { kind: "select"; index: number }
  | { kind: "focus_other" }
  | { kind: "submit_other" }
  | { kind: "dismiss" }
  | { kind: "navigate"; step: -1 | 1 }
  | { kind: "consume" };

type QuestionKey = {
  key: string;
  shift: boolean;
  modified: boolean;
  composing: boolean;
  repeat: boolean;
  source: QuestionKeySource;
  multiline: boolean;
  navigable: boolean;
  selected: number;
  count: number;
};

const option_digit = /^[1-9]$/;

const decisions = new Set<QuestionKeyAction["kind"]>(["choose", "submit_other", "dismiss"]);

const key_action = ({ key, shift, modified, source, multiline, navigable, selected, count }: QuestionKey): QuestionKeyAction | null => {
  if (key === "Escape") {
    return { kind: "dismiss" };
  }
  if (source === "input") {
    if (key === "Enter" && !shift) {
      return { kind: "submit_other" };
    }
    return key === "ArrowUp" && !multiline && count > 0 ? { kind: "select", index: count - 1 } : null;
  }
  if (navigable && (key === "ArrowLeft" || key === "ArrowRight")) {
    return { kind: "navigate", step: key === "ArrowLeft" ? -1 : 1 };
  }
  if (option_digit.test(key)) {
    if (modified) {
      return null;
    }
    const number = Number(key);
    if (number <= count) {
      return { kind: "choose", index: number - 1 };
    }
    return number === count + 1 ? { kind: "focus_other" } : null;
  }
  switch (key) {
    case "ArrowDown":
      return selected === -1 || selected === count - 1 ? { kind: "focus_other" } : { kind: "select", index: selected + 1 };
    case "ArrowUp":
      if (count === 0) {
        return null;
      }
      return { kind: "select", index: Math.max(0, selected === -1 ? count - 1 : selected - 1) };
    case "Enter":
      if (source === "button") {
        return null;
      }
      return selected >= 0 ? { kind: "choose", index: selected } : { kind: "submit_other" };
    default:
      return null;
  }
};

export const question_key_action = (input: QuestionKey): QuestionKeyAction | null => {
  if (input.composing) {
    return null;
  }
  const action = key_action(input);
  return action !== null && input.repeat && decisions.has(action.kind) ? { kind: "consume" } : action;
};
