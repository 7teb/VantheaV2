import type { Message } from "../../shared/chat.ts";
import { no_new_activity, type ScheduleInterval } from "../../shared/scheduled.ts";

export type RunNoteInput = { name: string; interval: ScheduleInterval; started_at: Date; earlier_runs: boolean; tool_names: ReadonlySet<string> };

export const cadence_text: Record<ScheduleInterval, string> = { "1h": "every hour", "2h": "every 2 hours", "24h": "every 24 hours", "7d": "every 7 days" };

const two = (value: number) => String(value).padStart(2, "0");

export const local_minute = (at: Date): string => `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;

const search_line = (tool_names: ReadonlySet<string>): string => {
  if (tool_names.has("web_search")) {
    return "Look things up with web_search; open a page with the browser tools only when a result needs a closer read.";
  }
  if (tool_names.has("browser_navigate")) {
    return "Web search is not configured in this app, so look things up with the built-in browser: open a search engine or the source page with browser_navigate and read it with browser_snapshot.";
  }
  return "";
};

const compare_block = [
  "Compare what you find with the answers of the earlier runs of this task in this chat and report only what is new or changed since the last run and matters for the task.",
  `- When nothing relevant is new, your whole final answer is exactly ${no_new_activity}: no other word, no punctuation, no explanation. The app then records the run as quiet and does not notify the user.`,
  "- When something relevant is new, start your final answer with one plain sentence that says what is new; the app shows that first line as the notification. Put the details after it.",
  `- When you could not check (a page did not load, a tool failed), say that in your answer; that is not ${no_new_activity}.`,
].join("\n");

const first_run_block =
  "This is the first run of this task, so there is no earlier run to compare with. Answer with what you found; it is the baseline later runs compare against. Start with one plain sentence that sums it up; the app shows that first line as the notification.";

export const run_note = (input: RunNoteInput): string => {
  const opening = `[Internal app event, not a user message. This turn is an unattended scheduled run of the task "${input.name}". VantheaX starts it ${cadence_text[input.interval]} while the app is open; this run started at ${local_minute(input.started_at)} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). The user may not be watching: do not ask questions or wait for answers, decide on your own and keep going.`;
  const work = ["Work quickly: do only what the task prompt needs, with the tools you have, and stop as soon as you have the answer.", search_line(input.tool_names)].filter(Boolean).join(" ");
  return `${opening}\n\n${work}\n\n${input.earlier_runs ? compare_block : first_run_block}]`;
};

export const answered_runs = (messages: readonly Message[]): number => {
  let count = 0;
  let scheduled = false;
  for (const message of messages) {
    if (message.role === "user") {
      scheduled = message.origin === "scheduled";
      continue;
    }
    if (scheduled && message.status === "done") {
      count += 1;
    }
    scheduled = false;
  }
  return count;
};

export const scheduled_prompt_content = (text: string): string => `[Scheduled task run started by VantheaX on the task's schedule. The task prompt:]\n\n${text}`;

export const scheduled_request_text = (text: string): string =>
  `Scheduled task prompt, set up in VantheaX for this chat; the app started this run on the task's schedule:\n${text}`;
