import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_agent_notice, parse_report_events, parse_update_events, report_event_context, report_event_text, report_file_notice, report_notice_context, report_notice_text, update_event_text, update_notice_text } from "../shared/agent-notes.ts";

const report_body = "# code report\n\nName: not a field\n\n- a\\b stays escaped";

test("legacy report and update notices still parse into their original display fields", () => {
  assert.deepEqual(parse_agent_notice(report_notice_text("code (subsystem)", "agent_ba59", "completed", 414, report_body)), {
    kind: "report",
    name: "code (subsystem)",
    agent_id: "agent_ba59",
    status: "completed",
    seconds: 414,
    body: report_body,
  });
  assert.deepEqual(parse_agent_notice(update_notice_text("Scout", "agent_1", "the parser is mine")), {
    kind: "update",
    name: "Scout",
    agent_id: "agent_1",
    status: "running",
    seconds: null,
    body: "the parser is mine",
  });
  assert.equal(parse_agent_notice("Older context was trimmed to fit"), null);
});

test("completion events carry report paths, IDs and read instructions for each agent", () => {
  const event = (name: string, report_path: string | null) =>
    report_event_text({ agent_id: `agent_${name}`, run_id: `run_${name}`, name, model: "m", profile: "explore", status: "completed", seconds: 61, report_path });
  const text = `${event("first", "C:/reports/first.report.md")}\n\n${event("second", null)}`;
  const notes = parse_report_events(text);
  assert.deepEqual(notes.map((note) => [note.name, note.agent_id, note.status, note.seconds]), [
    ["first", "agent_first", "completed", 61],
    ["second", "agent_second", "completed", 61],
  ]);
  assert.match(notes[0]?.body ?? "", /Run ID: run_first/);
  assert.match(notes[0]?.body ?? "", /Report file: C:\/reports\/first.report.md/);
  assert.match(notes[0]?.body ?? "", /Get-Content -LiteralPath/);
  assert.match(notes[0]?.body ?? "", /Select-String -Pattern 'search text' -LiteralPath 'C:\/reports\/first.report.md'/);
  assert.doesNotMatch(notes[0]?.body ?? "", /rg -n/);
  assert.match(notes[1]?.body ?? "", /get_agent_status/);
  assert.deepEqual(parse_report_events("[BACKGROUND TASK EVENT]\n\nsomething else"), []);
  assert.equal(report_event_context(text), text);
});

test("report commands quote apostrophes in paths and file failures are explicit", () => {
  const text = report_file_notice("agent_1", "run_1", "C:/O'Brien reports/run_1.report.md");
  assert.match(text, /'C:\/O''Brien reports\/run_1.report.md'/);
  assert.match(text, /complete report/);
  const failed = report_file_notice("agent_1", "run_1", null, "disk unavailable");
  assert.match(failed, /Report file: unavailable/);
  assert.match(failed, /disk unavailable/);
  assert.doesNotMatch(failed, /Get-Content/);
});

test("legacy notices keep their identity but do not put their inline report back into context", () => {
  const sentinel = "PRIVATE_REPORT_BODY_" + "x".repeat(40_000);
  const legacy = report_notice_text("Scout", "agent_1", "completed", 61, sentinel);
  const context = report_notice_context(legacy);
  assert.match(context, /Scout \(agent_1\)/);
  assert.match(context, /get_agent_status/);
  assert.doesNotMatch(context, /PRIVATE_REPORT_BODY/);
  const file = report_file_notice("agent_1", "run_1", "C:/reports/run_1.report.md");
  assert.equal(report_notice_context(report_notice_text("Scout", "agent_1", "completed", 61, file)), report_notice_text("Scout", "agent_1", "completed", 61, file));
});

test("legacy post-turn events omit inline bodies on replay", () => {
  const body = "PRIVATE_REPORT_BODY";
  const legacy = `[AGENT REPORT EVENT]\n\nAgent ID: agent_1\n\nRun ID: run_1\n\nName: Scout\n\nModel: m\n\nProfile: explore\n\nStatus: completed\n\nDuration: 61s\n\nReport:\n${body}`;
  const context = report_event_context(legacy);
  assert.match(context, /Agent ID: agent_1/);
  assert.match(context, /Run ID: run_1/);
  assert.match(context, /get_agent_status/);
  assert.doesNotMatch(context, /PRIVATE_REPORT_BODY/);
});

test("replayed file notices require a complete read and an explicit reason for unread reports", () => {
  const text = report_file_notice("agent_1", "run_1", "C:/reports/run_1.report.md");
  assert.ok(text.startsWith("YOU MUST READ THE COMPLETE REPORT"));
  assert.match(text, /DO NOT SKIP IT/);
  assert.match(text, /identify it and explain why in your final answer/);
  assert.match(text, /if output is truncated, read the remaining sections/);
  assert.match(text, /partial preview do not count/);
  assert.match(text, /\n\nAgent ID: agent_1\nRun ID: run_1\nReport file:/);
  assert.match(text, /Read the report:\nGet-Content/);
  const unavailable = report_file_notice("agent_1", "run_1", null, "access denied");
  assert.match(unavailable, /YOU MUST READ THE COMPLETE REPORT/);
  assert.match(unavailable, /state that the report was not read and give the actual reason/);
  assert.match(unavailable, /access denied/);
  const notification = report_notice_text("Scout", "agent_1", "completed", 61, text);
  assert.equal(report_notice_context(notification), notification);
});

test("old optional-read event outros stay outside the parsed report body", () => {
  const old = "Read the saved report when needed and use the findings to continue the original work. This is an internal event, not a user request that requires a reply. Do not acknowledge each notification, repeat earlier findings or announce that you are still waiting. If other reports are pending and no useful action or new user-facing result follows, process this silently and wait. Combine findings when they are ready; give a visible update only for meaningful new results, changed actions, blockers or required user decisions.";
  const notice = report_file_notice("agent_1", "run_1", "C:/reports/run_1.report.md");
  const legacy = ["[AGENT REPORT EVENT]", "Agent ID: agent_1", "Run ID: run_1", "Name: Scout", "Model: m", "Profile: explore", "Status: completed", "Duration: 61s", "Report:\n" + notice, old].join("\n\n");
  const notes = parse_report_events(legacy);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].body, notice);
  const refreshed = report_event_context(legacy);
  assert.match(refreshed, /YOU MUST READ THE COMPLETE REPORT/);
  assert.doesNotMatch(refreshed, /Read the saved report when needed/);
});

test("old update outros that invited a closing sentence stay outside the parsed update body", () => {
  const old = "Use this update to adjust your work: do not redo what the agent says it covers, and change your plan if the update shows that something it assumes is wrong. Do not acknowledge the update, recap it or announce that you are waiting. Speak only when it leads to a new result, a changed action, a blocker or a required user decision; otherwise continue silently, and if nothing needs to change right now, end this turn with at most one short sentence.";
  const legacy = ["[AGENT UPDATE EVENT]", "This is an internal app event.", "Agent ID: agent_1", "Run ID: run_1", "Name: Scout", "Update:\nthe parser is mine", old].join("\n\n");
  assert.deepEqual(parse_update_events(legacy), [{ kind: "update", name: "Scout", agent_id: "agent_1", status: "running", seconds: null, body: "the parser is mine" }]);
});

test("old update outros that asked for an empty response stay outside the parsed update body", () => {
  const old = "Use this update to adjust your work: do not redo what the agent says it covers, and change your plan if the update shows that something it assumes is wrong. Do not acknowledge the update, recap it or announce that you are waiting. Speak only when it leads to a new result, a changed action, a blocker or a required user decision; otherwise continue silently, and if nothing needs to change right now, end the response with no visible text.";
  const legacy = ["[AGENT UPDATE EVENT]", "This is an internal app event.", "Agent ID: agent_1", "Run ID: run_1", "Name: Scout", "Update:\nthe parser is mine", old].join("\n\n");
  assert.deepEqual(parse_update_events(legacy), [{ kind: "update", name: "Scout", agent_id: "agent_1", status: "running", seconds: null, body: "the parser is mine" }]);
});

test("report notices for a turn without agent tools do not name continue_agent or get_agent_status", () => {
  const saved = report_file_notice("agent_1", "run_1", "C:/reports/run_1.report.md", "", "", false);
  assert.match(saved, /Get-Content -LiteralPath/);
  assert.doesNotMatch(saved, /continue_agent|get_agent_status/);
  const missing = report_file_notice("agent_1", "run_1", null, "access denied", "", false);
  assert.match(missing, /state that the report was not read/);
  assert.doesNotMatch(missing, /continue_agent|get_agent_status/);
  const notice = report_notice_text("Scout", "agent_1", "completed", 61, saved);
  assert.doesNotMatch(report_notice_context(notice, false), /continue_agent|get_agent_status/);
  assert.match(report_notice_context(notice), /continue_agent/);
});

test("update events say they are internal, name the run and parse back into update rows", () => {
  const event = (name: string, text: string) => update_event_text({ agent_id: `agent_${name}`, run_id: `run_${name}`, name, text });
  const first = event("first", "the parser is mine\n\nskip it");
  assert.ok(first.startsWith("[AGENT UPDATE EVENT]"));
  assert.match(first, /internal app event, not a message written by the user/);
  assert.match(first, /Agent ID: agent_first/);
  assert.match(first, /Run ID: run_first/);
  assert.match(first, /Name: first/);
  assert.match(first, /still running/);
  assert.match(first, /final report notification will follow/);
  assert.match(first, /Do not acknowledge the update/);
  const notes = parse_update_events(`${first}\n\n${event("second", "found the leak")}`);
  assert.deepEqual(notes, [
    { kind: "update", name: "first", agent_id: "agent_first", status: "running", seconds: null, body: "the parser is mine\n\nskip it" },
    { kind: "update", name: "second", agent_id: "agent_second", status: "running", seconds: null, body: "found the leak" },
  ]);
  assert.equal(parse_update_events(first).length, 1);
  assert.match(first, /end the response with one short sentence that says what you are waiting for/);
  assert.doesNotMatch(first, /no visible text/);
  assert.doesNotMatch(first, /at most one short sentence/);
  assert.deepEqual(parse_report_events(first), []);
  assert.deepEqual(parse_update_events("[AGENT REPORT EVENT]\n\nName: x"), []);
});
