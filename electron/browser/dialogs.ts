import { page_untrusted_note } from "./console.ts";
import type { BrowserTab } from "./state.ts";

export type DialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export type DialogNote = { type: DialogType; url: string; message: string; outcome: string };

export type DialogLog = { notes: DialogNote[]; dropped: number };

const kept_dialog_notes = 20;

const message_chars = 1000;

const page_answers: readonly { type: DialogType; outcome: string }[] = [
  { type: "alert", outcome: "dismissed" },
  { type: "confirm", outcome: "cancelled, the page got false" },
  { type: "prompt", outcome: "cancelled, the page got null" },
];

export const dialog_log = (): DialogLog => ({ notes: [], dropped: 0 });

const kept_message = (text: string) => (text.length > message_chars ? `${text.slice(0, message_chars)} [${text.length - message_chars} more characters not kept]` : text);

export const record_dialog = (log: DialogLog, note: DialogNote) => {
  if (log.notes.length >= kept_dialog_notes) {
    log.dropped += 1;
    return;
  }
  log.notes.push({ ...note, message: kept_message(note.message) });
};

export const record_page_dialog = (log: DialogLog, params: Record<string, unknown>) => {
  const answer = page_answers.find((entry) => entry.type === params.type);
  if (!answer) {
    return;
  }
  record_dialog(log, { type: answer.type, url: String(params.url ?? ""), message: String(params.message ?? ""), outcome: answer.outcome });
};

const note_line = (tab: BrowserTab, note: DialogNote) => {
  const message = note.message ? ` with ${JSON.stringify(note.message)}` : "";
  return `- tab ${tab.tab_id}: ${note.type} on ${note.url}${message}: ${note.outcome}`;
};

export const take_dialog_report = (tabs: BrowserTab[]): string => {
  const lines: string[] = [];
  for (const tab of tabs) {
    lines.push(...tab.dialogs.notes.map((note) => note_line(tab, note)));
    if (tab.dialogs.dropped) {
      lines.push(`- tab ${tab.tab_id}: ${tab.dialogs.dropped} more dialogs were not kept`);
    }
    tab.dialogs = dialog_log();
  }
  if (!lines.length) {
    return "";
  }
  return ["JavaScript dialogs that pages in this chat's browser tabs opened since the last browser result:", page_untrusted_note, ...lines].join("\n");
};
