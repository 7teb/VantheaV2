import type { ModelEntry } from "../../shared/models.ts";
import { compact_threshold } from "../context/compact.ts";
import { result_cap_tokens } from "../context/estimate.ts";

type ReviewTarget = { kind: "changes" } | { kind: "pr"; number: number };

const target_of = (argument: string | null): ReviewTarget => (argument === null ? { kind: "changes" } : { kind: "pr", number: Number(argument) });

const tokens = (count: number) => `${count.toLocaleString("en-US")} tokens`;

export const reviewer_brief = [
  "You review a set of code changes for defects that hurt the project: wrong results, crashes, data loss, security holes (injection, path traversal, leaked secrets, missing validation at a trust boundary), races, resource leaks, broken error handling, and changes that break callers or a contract elsewhere in the code. Also check the changes against the project's instruction files (AGENTS.md, CLAUDE.md) where they set rules.",
  "",
  "The REVIEW MATERIAL at the end of this task holds the diff. Before you judge a change, read the surrounding code in the project files: the whole changed function, its callers and the code it calls. For a pull request the project files may be on another branch: the diff is the authority for the new code, the files are context only.",
  "",
  "Report only what you can tie to concrete lines. For every finding give the file and the new line number, one sentence stating the defect, the concrete input or state and the wrong outcome it leads to, whether you are certain or it is likely, and the fix in one sentence. Leave out formatting, naming and style unless an instruction file requires them, and do not report a theory you could not check in the code.",
  "",
  "Order the findings by severity. If you find nothing, say so plainly and list what you covered. Do not edit anything.",
].join("\n");

const subject_of = (target: ReviewTarget): string =>
  target.kind === "changes"
    ? "the current changes of this project: uncommitted changes and the commits of the current branch against its base"
    : `pull request #${target.number}`;

const material_of = (target: ReviewTarget): string =>
  target.kind === "changes"
    ? "Run git status --short; find the base as the remote default branch (git symbolic-ref --short refs/remotes/origin/HEAD, else origin/main or origin/master when it exists, else none); collect git diff HEAD, and when HEAD is not on the base also git log --oneline <base>..HEAD and git diff <base>...HEAD; list untracked files and include the content of untracked text files."
    : `Run gh pr view ${target.number} --json number,title,body,url,baseRefName,headRefName,author,files and gh pr diff ${target.number}. If the GitHub CLI is missing or not signed in, stop and tell the user to install it from https://cli.github.com and run gh auth login.`;

const size_rule = (model: ModelEntry): string => {
  const compact_at = Math.floor(model.context_length * compact_threshold(model));
  return [
    `Put in the whole diff. The reviewer runs on your model: its context window is ${tokens(model.context_length)}, and the app compacts its conversation once it reaches ${tokens(compact_at)}, counting about four characters as one token.`,
    `Only when the prompt with the whole diff would not fit below that point with room left for the files the reviewer reads and for its report, or when your deploy_agent call with it would not fit into one response of yours (at most ${tokens(model.max_output)} of output), put in the diff of the files with the most changed lines that fits and name the files left out, so the reviewer reads them from the project files.`,
  ].join(" ");
};

export const review_request_text = (argument: string | null, model: ModelEntry): string => {
  const target = target_of(argument);
  return [
    `Review ${subject_of(target)} with one independent reviewer, then report the findings you verified. Do not edit, stage, commit, push, check out, or comment on GitHub.`,
    "",
    `1. Collect the review material with read-only commands. ${material_of(target)} Each tool result is cut at ${tokens(result_cap_tokens)}, so collect a larger diff in parts, for example file by file. If the folder is not a Git repository or there is nothing to review, say so in one sentence and stop.`,
    `2. Deploy exactly one agent with deploy_agent: name "Reviewer", topic "review", profile "explore", no scope, your own model and effort. Its prompt is the REVIEWER BRIEF below word for word, followed by a section REVIEW MATERIAL with what is reviewed (branch and base, or the pull request number, title, URL and description), the changed files with their added and removed lines, and the diff. ${size_rule(model)}`,
    "3. Do not review the changes yourself while it runs. End your response with one sentence saying you are waiting for the reviewer's report.",
    "4. When the report arrives, verify every finding: open the cited file and lines (for a pull request, the diff) and keep a finding only when the code shows the failure the reviewer describes. Drop findings that do not hold, style preferences the project's instruction files do not require, and duplicates.",
    "5. Report the verified findings in the chat ordered by severity, each with file and line, one sentence stating the defect, the concrete input or state that triggers it and what goes wrong, and the fix in one sentence. End with one line saying how many of the reviewer's findings you dropped. If none hold, say that the review found no verified problems and what it covered.",
    "",
    "REVIEWER BRIEF",
    "",
    reviewer_brief,
  ].join("\n");
};
