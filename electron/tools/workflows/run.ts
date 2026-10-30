import type { WorkflowSummary } from "../../../shared/workflow.ts";
import { chat_meta } from "../../chats/store.ts";
import { active_turn } from "../../turn/active.ts";
import { run_id_pattern, type JournalRecord } from "../../workflows/records.ts";
import { start_workflow, type ArgsValue } from "../../workflows/runtime.ts";
import { inline_source, path_source, saved_source, type ScriptSource } from "../../workflows/saved.ts";
import { error_text } from "../../storage/coerce.ts";
import { get_run, read_calls, read_script_file, user_saved_dir } from "../../workflows/store.ts";
import { agent_text_gate, agent_text_subject } from "../agents/text-gate.ts";
import { read_string } from "../browser/common.ts";
import { guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError, type ToolContext, type ToolResult } from "../types.ts";
import { run_workflow_description } from "./text.ts";

type RunArgs = { script: string | null; script_path: string | null; name: string | null; args: ArgsValue; resume_from: string | null };

type Resume = { run_id: string; journal: Map<number, JournalRecord>; script: string; args: ArgsValue };

const unwrap_args = (value: unknown): unknown => {
  if (typeof value !== "string" || !/^\s*[[{]/.test(value)) {
    return value;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" ? parsed : value;
  } catch (error) {
    console.warn(`[workflows] args look like JSON but do not parse, kept as a string: ${error_text(error)}`);
    return value;
  }
};

const parse_run = (raw: Record<string, unknown>): RunArgs => {
  const script = read_string(raw, "script");
  const script_path = read_string(raw, "script_path")?.trim() || null;
  const name = read_string(raw, "name")?.trim() || null;
  const resume_from = read_string(raw, "resume_from")?.trim() || null;
  if (resume_from !== null && !run_id_pattern.test(resume_from)) {
    throw new ToolArgumentError("resume_from must be a workflow run id like wf_...");
  }
  if (script !== null && !script.trim()) {
    throw new ToolArgumentError("script must not be blank");
  }
  if (script === null && script_path === null && name === null && resume_from === null) {
    throw new ToolArgumentError("pass the script inline as script, a script file as script_path, a saved workflow as name, or resume_from to rerun an earlier run");
  }
  return { script, script_path, name, resume_from, args: Object.hasOwn(raw, "args") && raw.args !== undefined ? { present: true, value: unwrap_args(raw.args) } : { present: false, value: undefined } };
};

const resume_of = async (ctx: ToolContext, run_id: string): Promise<Resume> => {
  const stored = get_run(run_id);
  if (!stored || stored.summary.chat_id !== ctx.chat_id) {
    throw new Error(`No workflow run ${run_id} exists in this chat.`);
  }
  if (stored.summary.status === "running") {
    throw new Error(`Workflow run ${run_id} is still running; stop it with stop_workflow first, then resume from it.`);
  }
  const args: ArgsValue = stored.args_text === "" ? { present: false, value: undefined } : { present: true, value: JSON.parse(stored.args_text) };
  return { run_id, journal: await read_calls(run_id), script: await read_script_file(run_id), args };
};

const pick_source = async (ctx: ToolContext, args: RunArgs, resume: Resume | null): Promise<ScriptSource> => {
  if (args.script_path !== null) {
    return path_source(ctx.project_root, args.script_path);
  }
  if (args.script !== null) {
    return inline_source(args.script);
  }
  if (args.name !== null) {
    return saved_source(ctx.project_root, user_saved_dir(), args.name);
  }
  if (!resume) {
    throw new ToolArgumentError("no script source was given");
  }
  return inline_source(resume.script);
};

const args_text = (args: ArgsValue): string => (args.present ? JSON.stringify(args.value, null, 2) ?? "null" : "(no args)");

const view_of = (summary: WorkflowSummary) => ({ kind: "workflow" as const, run_id: summary.run_id, name: summary.name, status: summary.status, script_path: summary.script_path });

const started_text = (summary: WorkflowSummary, resume: Resume | null): string => {
  const reused = resume ? [...resume.journal.values()].filter((record) => record.end?.status === "completed" || record.end?.status === "skipped").length : 0;
  return [
    `Started workflow ${summary.name} (run ${summary.run_id}) in the background: ${summary.description}`,
    ...(resume ? [`It resumes ${resume.run_id}: up to ${reused} journaled agent result${reused === 1 ? "" : "s"} return at once while the script makes the same calls in the same order; the first changed or new call and everything after it runs live.`] : []),
    "Its return value arrives automatically as a workflow result notice when it ends. Do not poll, do not wait with sleeps and do not guess the result; continue with independent work or end your response with one short sentence that says you are waiting for the workflow.",
    `The script is saved at ${summary.script_path}. To change it after this run ended, edit that file and call run_workflow with script_path and resume_from ${summary.run_id}, or pass the edited script inline with resume_from. stop_workflow with run_id ${summary.run_id} stops it and all its agents.`,
  ].join("\n");
};

const run_workflow = async (ctx: ToolContext, args: RunArgs): Promise<ToolResult> => {
  const parent = active_turn(ctx.chat_id);
  if (!parent || parent.message_id !== ctx.turn_id) {
    throw new Error("Workflows can only be started from a running turn of this chat.");
  }
  const resume = args.resume_from ? await resume_of(ctx, args.resume_from) : null;
  const source = await pick_source(ctx, args, resume);
  const value: ArgsValue = args.args.present ? args.args : (resume?.args ?? { present: false, value: undefined });
  const { meta } = source.read;
  const header = [
    `run_workflow, workflow ${meta.name}: ${meta.description}`,
    `source ${source.path ?? "inline script"}${resume ? `, resuming ${resume.run_id}` : ""}`,
    `args ${args_text(value)}`,
    "the script (plain JavaScript; every agent it starts runs under this chat's permission mode with its own approvals and reviews)",
  ];
  const gate = await agent_text_gate(ctx, { tool: "run_workflow", to_name: meta.name, to_id: null, about: meta.description, text: `${source.text}\n\nargs: ${args_text(value)}` }, agent_text_subject(header, source.text));
  if (gate.kind !== "pass") {
    return { status: "denied", text: gate.text, view: null };
  }
  ctx.signal.throwIfAborted();
  const started = await start_workflow({
    context: {
      chat_id: ctx.chat_id,
      parent_message_id: ctx.turn_id,
      parent_call_id: ctx.call_id,
      project_root: ctx.project_root,
      project_path: chat_meta(ctx.chat_id)?.project_path || ctx.project_root,
      user_request: ctx.user_request,
      mode: ctx.mode,
      settings: ctx.settings,
      model_id: parent.model.id,
      effort: parent.effort,
    },
    source,
    args: value,
    resume: resume ? { run_id: resume.run_id, journal: resume.journal } : null,
  });
  if (started.start_error && started.summary.status === "stopped") {
    return {
      status: "failed",
      text: `The workflow was stopped before its script ran, nothing ran: ${started.start_error}\nThe script is saved at ${started.summary.script_path}; call run_workflow again to run it.`,
      view: view_of(started.summary),
    };
  }
  if (started.start_error) {
    return {
      status: "failed",
      text: `The workflow did not start, nothing ran:\n${started.start_error}\nThe script is saved at ${started.summary.script_path}; fix it and call run_workflow again.`,
      view: view_of(started.summary),
    };
  }
  return { status: "done", text: started_text(started.summary, resume), view: view_of(started.summary) };
};

export const run_workflow_tool = define_tool<RunArgs>({
  spec: {
    name: "run_workflow",
    description: run_workflow_description,
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "The whole workflow script inline: plain JavaScript that starts with export const meta = { name, description, ... }. Do not write it to a file first." },
        script_path: { type: "string", description: "Path of a script file instead of script: the script path an earlier run_workflow result returned, or a .js file (absolute or relative to the project root). Wins over script and name." },
        name: { type: "string", description: "A saved workflow by its file name without .js, from .vantheax/workflows of the project or the user's saved workflow folder." },
        args: { description: "Any JSON value, handed to the script verbatim as the global args. Pass arrays and objects as real JSON, not as JSON-encoded strings. On a resume without args the resumed run's args are used." },
        resume_from: { type: "string", description: "Run id (wf_...) of an ended run of this chat to resume: the longest unchanged prefix of agent() calls returns the journaled results at once, the first changed or new call and everything after it runs live. Without a script source the resumed run's script is reused." },
      },
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_run,
  run: (ctx, args) => guarded(ctx, "run_workflow", () => run_workflow(ctx, args)),
});
