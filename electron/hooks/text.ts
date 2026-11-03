import type { TurnError } from "../../shared/chat.ts";
import { parse_hook_notice, type HookNote, type HookRun } from "../../shared/hook-notes.ts";
import type { HookEvent } from "../../shared/hooks.ts";
import { shell_labels } from "../../shared/shell.ts";
import { cap_text, estimate_tokens, result_cap_tokens } from "../context/estimate.ts";
import type { HookText } from "./fire.ts";

type Attributed = { command: string; text: string };

const reason_of = (text: string): string => text.trim() || "no reason given";

const one_line = (command: string): string => command.replace(/\s*[\r\n]+\s*/g, " ");

const blocked_lead = "Blocked by a PreToolUse hook the user set up. The tool call did not run.";

const blocked_guidance =
  "Do not run it again unchanged and do not reach its result another way; that counts as deliberately working around the user's hook. If the reason names an allowed way, use that way. Otherwise leave this step out, continue with the rest of the task, and say in your reply what you need and why, so the user can decide.";

export const blocked_tool_text = (blocks: HookText[]): string => {
  const reasons = blocks.map(({ hook, text }) => `Hook: ${shell_labels[hook.shell]} ${one_line(hook.command)}\nReason: ${reason_of(text)}`).join("\n");
  const room = result_cap_tokens - estimate_tokens(`${blocked_lead}\n\n${blocked_guidance}`);
  return [blocked_lead, cap_text(reasons, room), blocked_guidance].join("\n");
};

export const with_feedback = (feedback: string, output: string): string => {
  const whole = `${feedback}\n\n${output}`;
  if (estimate_tokens(whole) <= result_cap_tokens) {
    return whole;
  }
  const share = Math.floor(result_cap_tokens / 2);
  const feedback_room = Math.max(share, result_cap_tokens - estimate_tokens(`\n\n${output}`));
  const output_room = Math.max(share, result_cap_tokens - estimate_tokens(`${feedback}\n\n`));
  return `${cap_text(feedback, feedback_room)}\n\n${cap_text(output, output_room)}`;
};

const output_block = (event: HookEvent, entries: Attributed[]): string =>
  entries.map(({ command, text }) => `Output of a ${event} hook the user set up (\`${one_line(command)}\`):\n${text.trim()}`).join("\n\n");

export const post_tool_feedback = (event: HookEvent, runs: HookRun[]): string => output_block(event, run_texts(runs, ["blocked", "context"]));

export const hook_turn_error = (blocks: HookText[]): TurnError => ({
  kind: "hook",
  message: blocks.map(({ hook, text }) => `${shell_labels[hook.shell]} hook \`${one_line(hook.command)}\`: ${reason_of(text)}`).join("\n"),
});

const run_texts = (runs: HookRun[], statuses: HookRun["status"][]): Attributed[] =>
  runs.flatMap((run) => {
    if (!statuses.includes(run.status)) {
      return [];
    }
    if (run.status === "blocked") {
      return [{ command: run.command, text: reason_of(run.text) }];
    }
    return run.text.trim() ? [{ command: run.command, text: run.text }] : [];
  });

const continue_text = (event: "Stop" | "SubagentStop", asked: Attributed[]): string =>
  asked.length ? `A ${event} hook the user set up asked you to continue before ending the ${event === "Stop" ? "turn" : "run"}:\n${asked.map(({ text }) => text.trim()).join("\n\n")}` : "";

const note_text = (note: HookNote): string => {
  switch (note.event) {
    case "UserPromptSubmit":
      return note.runs.some((run) => run.status === "blocked") ? "" : output_block(note.event, run_texts(note.runs, ["context"]));
    case "SubagentStart":
      return output_block(note.event, run_texts(note.runs, ["context"]));
    case "Stop":
    case "SubagentStop":
      return continue_text(note.event, run_texts(note.runs, ["blocked", "context"]));
    default:
      return "";
  }
};

export const hook_note_content = (note: HookNote): string => cap_text(note_text(note), result_cap_tokens);

export const hook_notice_content = (text: string): string => {
  const note = parse_hook_notice(text);
  return note ? hook_note_content(note) : "";
};
