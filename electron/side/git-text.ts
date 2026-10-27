import { estimate_tokens } from "../context/estimate.ts";
import { side_window } from "../model/catalog.ts";

export const commit_message_system =
  'You write git commit messages. You get the diff of one commit, the list of changed files, and the subjects of the latest commits of this repository. Write the message in the language of those subjects, English when there are none. First line: at most 72 characters, imperative mood, saying what the change does, in the style of the latest subjects (use a prefix such as "fix:" or a ticket key only when they do). Add a body after one blank line only when the first line cannot carry why the change was made or what it affects; wrap it at 72 characters. Describe the change, not how it was made. Never add a trailer, a sign-off, a co-author line, an issue reference that is not in the diff, or the name of any tool, assistant or model. Output only the message, no code fence and no explanation.';

export const pr_text_system =
  "You write the title and description of a GitHub pull request. You get the commits of the branch and its diff against the base branch. Write in the language of the commits, English when unclear. Line 1 is the title: at most 72 characters, saying what the pull request does. Then one blank line, then the description in GitHub Markdown: one short paragraph on what changes and why, then a list of the notable changes, then how it was tested only when the commits or the diff show it. Do not invent tests, issues, screenshots or links. Never mention any tool, assistant or model and add no generated-by line. Output only the title line and the description, no code fence.";

export const clean_git_text = (raw: string): string => {
  const text = raw.trim();
  const fenced = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/.exec(text);
  return (fenced ? (fenced[2] ?? "") : text).trim();
};

export const split_pr_text = (raw: string): { title: string; body: string } => {
  const lines = clean_git_text(raw).split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first < 0) {
    return { title: "", body: "" };
  }
  const title = (lines[first] ?? "")
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^title\s*:\s*/i, "")
    .trim();
  return { title, body: lines.slice(first + 1).join("\n").trim() };
};

export const git_text_room = async (system: string): Promise<number> => {
  const { model_catalog } = await import("../model/catalog-file.ts");
  const window = side_window(await model_catalog(), "git_text");
  return window.context_length - window.max_output - estimate_tokens(system);
};

export const write_git_text = async (system: string, material: string): Promise<string> => {
  const { side_complete } = await import("./model.ts");
  const reply = await side_complete(
    "git_text",
    [
      { role: "system", content: system },
      { role: "user", content: material },
    ],
    null,
    new AbortController().signal,
  );
  return reply.text;
};
