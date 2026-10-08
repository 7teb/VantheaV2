export type AgentNote = {
  kind: "report" | "update";
  name: string;
  agent_id: string;
  status: string;
  seconds: number | null;
  body: string;
};

export type ReportEvent = {
  agent_id: string;
  run_id: string;
  name: string;
  model: string;
  profile: string;
  status: string;
  seconds: number;
  report_path: string | null;
  report_error?: string;
  stop_reason?: string;
  has_report?: boolean;
};

const report_head = /^(.*) \(([^()\s]+)\) finished with status (\w+) after (\d+)s\.$/;

const update_head = /^(.*) \(([^()\s]+)\) sent an update while still running\.$/;

const report_event_marker = "[AGENT REPORT EVENT]";

const legacy_report_event_outro =
  "Use this report as new evidence and continue the original work if it is still relevant. Do not say the user sent this event and do not merely announce that the agent finished: take the next required step, or reply briefly if nothing is left.";

const previous_report_event_outro =
  "Read the saved report when needed and use the findings to continue the original work. This is an internal event, not a user request that requires a reply. Do not acknowledge each notification, repeat earlier findings or announce that you are still waiting. If other reports are pending and no useful action or new user-facing result follows, process this silently and wait. Combine findings when they are ready; give a visible update only for meaningful new results, changed actions, blockers or required user decisions.";

const report_event_outro =
  "Read the complete saved report before using its findings or writing your final answer. If it remains unread, clearly identify it and explain why in your final answer. This is an internal event, not a user request that requires an acknowledgment. Read silently when no user-facing update is useful; combine the findings when ready and speak only for meaningful results, changed actions, blockers or required user decisions.";

const report_label = "\n\nReport:\n";

const field_of = (text: string, label: string) => new RegExp(`^${label}: (.*)$`, "m").exec(text)?.[1]?.trim() ?? "";

const powershell_path = (value: string) => `'${value.replaceAll("'", "''")}'`;

const report_read_instruction = "YOU MUST READ THE COMPLETE REPORT BEFORE USING ITS FINDINGS OR WRITING YOUR FINAL ANSWER. DO NOT SKIP IT.";

const unread_instruction = "If the report remains unread, explicitly identify it and explain why in your final answer. Do not present unread findings as verified.";

const missing_report = "Report: none. The agent's final response contained no report, so its results were not delivered.";

export const report_file_notice = (agent_id: string, run_id: string, report_path: string | null, report_error = "", stop_reason = "", has_report = true): string => {
  const identity = ["Agent ID: " + agent_id, "Run ID: " + (run_id || "not recorded in this older notification"), ...(stop_reason ? ["Model stop reason: " + stop_reason] : [])];
  if (!has_report) {
    return [
      ...identity,
      missing_report,
      "",
      `Continue it with continue_agent and agent_id "${agent_id}", and tell it to finish the task and end with its final report. Do not treat this run as a result.`,
    ].join("\n");
  }
  if (!report_path) {
    return [
      report_read_instruction,
      unread_instruction,
      "",
      ...identity,
      "Report file: unavailable",
      ...(report_error ? ["Report file error: " + report_error] : []),
      "",
      "Call get_agent_status with this agent_id to recover the report path, then read the complete file. Its contents have not been loaded into your context.",
      "If the file cannot be recovered or opened, state that the report was not read and give the actual reason.",
    ].join("\n");
  }
  const quoted = powershell_path(report_path);
  return [
    report_read_instruction,
    unread_instruction,
    "",
    ...identity,
    "Report file: " + report_path,
    "",
    "The complete report is saved as UTF-8. Its contents have not been loaded into your context. Read it with run_command; if output is truncated, read the remaining sections. Search matches or a partial preview do not count as reading the complete report.",
    "",
    "Read the report:",
    "Get-Content -LiteralPath " + quoted + " -Encoding UTF8",
    "",
    "Search within the report:",
    "rg -n -- \'search text\' " + quoted,
    "",
    "Project-scoped file tools may not reach this app storage path; use run_command for this saved file.",
  ].join("\n");
};

export const report_notice_text = (name: string, agent_id: string, status: string, seconds: number, report: string): string =>
  `${name} (${agent_id}) finished with status ${status} after ${seconds}s.\n\nREPORT:\n${report || "(empty report)"}`;

export const update_notice_text = (name: string, agent_id: string, update: string): string =>
  `${name} (${agent_id}) sent an update while still running.\n\nUPDATE:\n${update}`;

export const parse_agent_notice = (text: string): AgentNote | null => {
  const split = text.indexOf("\n\n");
  const head = split < 0 ? text : text.slice(0, split);
  const rest = split < 0 ? "" : text.slice(split + 2);
  const report = report_head.exec(head);
  if (report) {
    return { kind: "report", name: report[1] ?? "", agent_id: report[2] ?? "", status: report[3] ?? "", seconds: Number(report[4]), body: rest.replace(/^REPORT:\n/, "") };
  }
  const update = update_head.exec(head);
  if (update) {
    return { kind: "update", name: update[1] ?? "", agent_id: update[2] ?? "", status: "running", seconds: null, body: rest.replace(/^UPDATE:\n/, "") };
  }
  return null;
};

export const report_event_text = (event: ReportEvent): string =>
  [
    report_event_marker,
    "This is an internal app event, not a message written by the user. A sub-agent you deployed earlier in this chat has finished.",
    `Agent ID: ${event.agent_id}`,
    `Run ID: ${event.run_id}`,
    `Name: ${event.name}`,
    `Model: ${event.model}`,
    `Profile: ${event.profile}`,
    `Status: ${event.status}`,
    `Duration: ${event.seconds}s`,
    `Report:\n${report_file_notice(event.agent_id, event.run_id, event.report_path, event.report_error, event.stop_reason, event.has_report)}`,
    report_event_outro,
  ].join("\n\n");

const event_note = (chunk: string): AgentNote => {
  const at = chunk.indexOf(report_label);
  const head = at < 0 ? chunk : chunk.slice(0, at);
  const tail = at < 0 ? "" : chunk.slice(at + report_label.length);
  const end = Math.max(...[report_event_outro, previous_report_event_outro, legacy_report_event_outro].map((outro) => tail.lastIndexOf(`\n\n${outro}`)));
  const seconds = Number.parseInt(field_of(head, "Duration"), 10);
  return {
    kind: "report",
    name: field_of(head, "Name"),
    agent_id: field_of(head, "Agent ID"),
    status: field_of(head, "Status"),
    seconds: Number.isFinite(seconds) ? seconds : null,
    body: (end < 0 ? tail : tail.slice(0, end)).trim(),
  };
};

export const parse_report_events = (text: string): AgentNote[] => text.split(report_event_marker).slice(1).map(event_note);

const reported = (body: string): boolean => !body.includes(missing_report);

const saved_path = (body: string): string | null => {
  const value = field_of(body, "Report file");
  return value && value !== "unavailable" ? value : null;
};

export const report_notice_context = (text: string): string => {
  const note = parse_agent_notice(text);
  if (!note || note.kind !== "report") {
    return "A previous sub-agent report notification has no saved file reference. Use get_agent_status to locate its report.";
  }
  const body = report_file_notice(
    note.agent_id,
    field_of(note.body, "Run ID"),
    saved_path(note.body),
    field_of(note.body, "Report file error"),
    field_of(note.body, "Model stop reason"),
    reported(note.body),
  );
  return report_notice_text(note.name, note.agent_id, note.status, note.seconds ?? 0, body);
};

export const report_event_context = (text: string): string =>
  text.split(report_event_marker).slice(1).map((chunk) => {
    const note = event_note(chunk);
    const at = chunk.indexOf(report_label);
    const head = at < 0 ? chunk : chunk.slice(0, at);
    return report_event_text({
      agent_id: note.agent_id,
      run_id: field_of(head, "Run ID"),
      name: note.name,
      model: field_of(head, "Model"),
      profile: field_of(head, "Profile"),
      status: note.status,
      seconds: note.seconds ?? 0,
      report_path: saved_path(note.body),
      report_error: field_of(note.body, "Report file error"),
      stop_reason: field_of(note.body, "Model stop reason"),
      has_report: reported(note.body),
    });
  }).join("\n\n");

export const agent_status_context = (text: string): string => {
  const at = text.indexOf("\nReport:\n");
  return at < 0 ? text : `${text.slice(0, at)}\nCall get_agent_status to obtain the complete report file path. The older inline report has been omitted.`;
};
