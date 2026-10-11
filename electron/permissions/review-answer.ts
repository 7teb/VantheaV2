import { review_verdicts, rule_sources, type ReviewAnswer } from "../../shared/review.ts";
import { error_text } from "../storage/coerce.ts";
import type { JsonSchema } from "../tools/types.ts";

export const review_schema_name = "command_review";

export const review_schema: JsonSchema = {
  type: "object",
  properties: {
    rule_source: {
      type: "string",
      enum: [...rule_sources],
      description: "Where the restriction the verdict relies on comes from. none when it relies on a permission or on no restriction.",
    },
    rule: {
      type: "string",
      description: "That restriction, a rule that forbids or limits the action, quoted exactly from its source, at most 200 characters. Never the human's request or a permission. Empty when rule_source is none.",
    },
    workaround_of: {
      type: "string",
      description: "With decision deny only: the id of the blocking EARLIER DECISIONS line whose effect the action reaches. Otherwise empty.",
    },
    script_summary: {
      type: "string",
      description: "When SCRIPTS RUN BY THIS ACTION is present: one English line of at most 200 characters on what those scripts do. Otherwise empty.",
    },
    reason: {
      type: "string",
      description: "One or two short sentences, at most 400 characters, read by the user and the agent: the concrete target and effect, and why. In the language of the human's recent messages; English when they write English.",
    },
    decision: {
      type: "string",
      enum: [...review_verdicts],
    },
  },
  required: ["rule_source", "rule", "workaround_of", "script_summary", "reason", "decision"],
  additionalProperties: false,
};

export const review_response_format = { type: "json_schema", json_schema: { name: review_schema_name, strict: true, schema: review_schema } };

const max_answer_chars = 8000;

const reason_chars = 400;

const rule_chars = 200;

const summary_chars = 200;

export type AnswerContext = { blocking: ReadonlySet<string>; known: ReadonlySet<string>; scripts: boolean };

export type ParsedAnswer = { kind: "answer"; answer: ReviewAnswer; workaround: string | null } | { kind: "unreadable"; problem: string };

const unreadable = (text: string, problem: string): ParsedAnswer => {
  console.warn(`[permissions] review answer ${problem}: ${text.slice(0, 200)}`);
  return { kind: "unreadable", problem };
};

const parse_object = (text: string): { value: unknown } | { problem: string } => {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) {
    return { problem: "contains no JSON object" };
  }
  try {
    return { value: JSON.parse(json) };
  } catch {
    try {
      return { value: JSON.parse(json.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\")) };
    } catch (error) {
      return { problem: `is invalid JSON (${error_text(error)})` };
    }
  }
};

const text_field = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const one_line = (value: string): string => value.replace(/\s*[\r\n]+\s*/g, " ").trim();

export const parse_review_answer = (text: string, finish_reason: string | null, context: AnswerContext): ParsedAnswer => {
  if (finish_reason === "length") {
    return unreadable(text, "was cut off at the output limit");
  }
  if (!text.trim()) {
    return unreadable(text, "is empty");
  }
  if (text.length > max_answer_chars) {
    return unreadable(text, `is longer than ${max_answer_chars} characters`);
  }
  const parsed = parse_object(text);
  if ("problem" in parsed) {
    return unreadable(text, parsed.problem);
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return unreadable(text, "is not an object");
  }
  const raw = parsed.value as Record<string, unknown>;
  const decision = review_verdicts.find((entry) => entry === raw.decision);
  if (!decision) {
    return unreadable(text, "has no valid decision");
  }
  const rule = text_field(raw.rule).slice(0, rule_chars);
  const rule_source = rule ? rule_sources.find((entry) => entry === raw.rule_source && entry !== "none") : undefined;
  const workaround_of = text_field(raw.workaround_of);
  if (workaround_of && decision === "allow") {
    return unreadable(text, `allows and names ${workaround_of.slice(0, 40)} as a workaround`);
  }
  let workaround: string | null = null;
  if (workaround_of && decision === "deny" && context.blocking.has(workaround_of)) {
    workaround = workaround_of;
  } else if (workaround_of) {
    const why = decision === "review" ? "on a review" : context.known.has(workaround_of) ? "for a line that does not block" : "for an unknown line";
    console.warn(`[permissions] review answer names workaround_of ${workaround_of.slice(0, 40)} ${why}, dropped: ${text.slice(0, 200)}`);
  }
  const answer: ReviewAnswer = {
    rule_source: rule_source ?? "none",
    rule: rule_source ? rule : "",
    workaround_of: workaround ?? "",
    script_summary: context.scripts ? one_line(text_field(raw.script_summary)).slice(0, summary_chars) : "",
    reason: text_field(raw.reason).slice(0, reason_chars),
    decision,
  };
  return { kind: "answer", answer, workaround };
};
