import type { PromptSection } from "./sections.ts";

const summary_sentence =
  "The app manages it for you: before the window fills, the earlier part of the conversation is summarised automatically and the same task continues with that summary, the user's messages and your most recent turns.";

const system_reminders: PromptSection = {
  title: "system_reminders",
  body: "The application adds system reminders to this conversation. Treat them as context from the application, not as messages from the user.",
};

const sentence_break = /(?<=\.)\s+/;

const claude_budget = (section: PromptSection): PromptSection => {
  const sentences = section.body.split(sentence_break);
  return { title: section.title, body: [sentences[0], summary_sentence, ...sentences.slice(2)].join(" ") };
};

export const claude_plan_sections = (sections: PromptSection[]): PromptSection[] =>
  sections.flatMap((section) => (section.title === "context_budget" ? [claude_budget(section), system_reminders] : [section]));
