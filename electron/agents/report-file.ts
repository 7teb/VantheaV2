import fs from "node:fs/promises";
import { apply_events } from "../../shared/apply-event.ts";
import type { TranscriptState } from "../../shared/events.ts";
import { error_code } from "../storage/coerce.ts";
import { write_file_atomic } from "../storage/json-file.ts";
import { read_journal } from "./journal.ts";
import { report_text } from "./live.ts";
import { parse_event, type AgentRecord, type RunRecord, type StoredEvent } from "./records.ts";
import { run_file } from "./store.ts";

export const report_file = (agent_id: string, run_id: string): string =>
  run_file(agent_id, run_id).replace(/\.jsonl$/, ".report.md");

export const write_report_file = async (agent_id: string, run_id: string, report: string): Promise<string> => {
  const file = report_file(agent_id, run_id);
  await write_file_atomic(file, report);
  return file;
};

export const ensure_report_file = async (agent: AgentRecord, run: RunRecord): Promise<string> => {
  const file = report_file(agent.agent_id, run.run_id);
  try {
    if (!(await fs.stat(file)).isFile()) {
      throw new Error(`Report path is not a file: ${file}`);
    }
    return file;
  } catch (error) {
    if (error_code(error) !== "ENOENT") {
      throw error;
    }
  }
  const events = (await read_journal(run_file(agent.agent_id, run.run_id)))
    .map(parse_event)
    .filter((event): event is StoredEvent => event !== null)
    .sort((left, right) => left.seq - right.seq);
  const state: TranscriptState = {
    status: "streaming",
    steps: [],
    reasoning_details: [],
    retry: null,
    error: null,
    context: null,
    last_seq: 0,
    ended_at: null,
  };
  const original = report_text(apply_events(state, events));
  const marker = "\n\nLast output:\n";
  const at = run.report.indexOf(marker);
  const report = original ? (at >= 0 ? `${run.report.slice(0, at)}${marker}${original}` : original) : run.report;
  return write_report_file(agent.agent_id, run.run_id, report);
};
