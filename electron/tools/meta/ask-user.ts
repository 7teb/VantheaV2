import type { AskQuestion } from "../../../shared/questions.ts";
import { define_tool, ToolArgumentError } from "../types.ts";

const max_questions = 3;

const max_title_chars = 600;

const max_options = 6;

const max_option_chars = 200;

export const ask_user_result =
  'Shown to the user above the message box. This call does not wait: keep working on what does not depend on the answer and say which assumption you continue with. If the user answers, the answer arrives later as a user message starting with "Answer to your question". A dismissed question sends nothing.';

const collapse = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

const parse_option = (value: unknown, index: number, at: number): string => {
  const option = collapse(value);
  if (!option || option.length > max_option_chars) {
    throw new ToolArgumentError(`questions[${index}].options[${at}] must be a non-empty string of at most ${max_option_chars} characters`);
  }
  return option;
};

const parse_options = (value: unknown, index: number): string[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.length || value.length > max_options) {
    throw new ToolArgumentError(`questions[${index}].options must be a list of 1 to ${max_options} answers`);
  }
  return value.map((option, at) => parse_option(option, index, at));
};

const parse_question = (value: unknown, index: number): AskQuestion => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolArgumentError(`questions[${index}] must be an object with a title and optional options`);
  }
  const raw = value as Record<string, unknown>;
  const title = collapse(raw.title);
  if (!title || title.length > max_title_chars) {
    throw new ToolArgumentError(`questions[${index}].title must be a non-empty string of at most ${max_title_chars} characters`);
  }
  return { title, options: parse_options(raw.options, index) };
};

const parse_questions = (raw: Record<string, unknown>): AskQuestion[] => {
  if (!Array.isArray(raw.questions) || !raw.questions.length || raw.questions.length > max_questions) {
    throw new ToolArgumentError(`questions must be a list of 1 to ${max_questions} questions`);
  }
  return raw.questions.map(parse_question);
};

export const ask_user_tool = define_tool<AskQuestion[]>({
  spec: {
    name: "ask_user",
    description:
      'Ask the user up to 3 short questions while you keep working. Use it only when the answer changes what you do and you cannot get it from the project, the conversation or your tools: a missing fact, a preference, a constraint, or a choice between real alternatives. The call returns at once; it does not wait, pause or end your turn. If the user answers, the answer arrives later as a user message that starts with "Answer to your question": during this turn at the start of your next round, otherwise as a new turn. The user can dismiss a question, and then nothing arrives. Do not use it to ask whether you may run a command or write a file; those calls ask for approval themselves.',
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "1 to 3 questions, the most important first.",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "The complete question in one or two sentences, with the context needed to answer it without reading the transcript. At most 600 characters.",
              },
              options: {
                type: "array",
                items: { type: "string" },
                description:
                  'Suggested answers in display order, recommended first, a few words each, at most 6. Do not add an "Other" entry: the form always has a free-text field. Leave options out for a free-text question.',
              },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "plan"],
  parse: parse_questions,
  run: async (...[, questions]) => ({ status: "done", text: ask_user_result, view: { kind: "questions", questions } }),
});
