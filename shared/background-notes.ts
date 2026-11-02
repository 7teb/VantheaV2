import { shell_labels } from "./shell.ts";

export const background_event_marker = "[BACKGROUND TASK EVENT]";

export const background_event_labels = { shell: "Shell", command: "Command", status: "Status", exit_code: "Exit code", output: "Output" } as const;

export type BackgroundEvent = { shell: string; command: string; status: string; exit_code: number | null; output: string };

const event_separator = `\n\n${background_event_marker}\n\n`;

const field_at = (sections: string[], label: string, after: number) => sections.findIndex((section, index) => index > after && section.startsWith(`${label}: `));

const field_value = (section: string, label: string) => section.slice(label.length + 2);

const output_of = (sections: string[]): string | null => {
  const body = sections.join("\n\n");
  if (body === `${background_event_labels.output}: empty`) {
    return "";
  }
  const newline = body.indexOf("\n");
  return newline > 0 ? body.slice(newline + 1) : null;
};

export const parse_background_event = (text: string): BackgroundEvent | null => {
  const sections = text.split("\n\n");
  if (sections[0] !== background_event_marker) {
    return null;
  }
  const command_at = field_at(sections, background_event_labels.command, 0);
  const shell_at = field_at(sections.slice(0, command_at), background_event_labels.shell, 0);
  const status_at = field_at(sections, background_event_labels.status, command_at);
  const exit_at = field_at(sections, background_event_labels.exit_code, status_at);
  const output_at = sections.findIndex((section, index) => index > exit_at && section.startsWith(background_event_labels.output));
  if (command_at < 0 || status_at < 0 || exit_at < 0 || output_at < 0) {
    return null;
  }
  const exit_text = field_value(sections[exit_at], background_event_labels.exit_code);
  const exit_code = exit_text === "none" ? null : Number(exit_text);
  const output = output_of(sections.slice(output_at, -1));
  if (output === null || (exit_code !== null && !Number.isInteger(exit_code))) {
    return null;
  }
  return {
    shell: shell_at < 0 ? shell_labels.powershell : field_value(sections[shell_at], background_event_labels.shell),
    command: field_value(sections.slice(command_at, status_at).join("\n\n"), background_event_labels.command),
    status: field_value(sections[status_at], background_event_labels.status),
    exit_code,
    output,
  };
};

export const parse_background_events = (text: string): BackgroundEvent[] =>
  text
    .split(event_separator)
    .map((part, index) => (index === 0 ? part : `${background_event_marker}\n\n${part}`))
    .flatMap((part) => parse_background_event(part) ?? []);
