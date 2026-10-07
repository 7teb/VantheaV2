import { report_file_notice } from "../../../shared/agent-notes.ts";
import { last_text, live_run } from "../../agents/live.ts";
import { ensure_report_file } from "../../agents/report-file.ts";
import { current_run, type AgentRecord, type RunRecord } from "../../agents/records.ts";
import { cancel_agent, message_agent } from "../../agents/runner.ts";
import { failed, guarded } from "../fs/common.ts";
import { define_tool } from "../types.ts";
import { agent_id_property, agent_view, read_agent_id, read_text, resolve_agent } from "./common.ts";

const activity_chars = 500;

const id_parameters = {
  type: "object" as const,
  properties: { agent_id: agent_id_property },
  required: ["agent_id"],
  additionalProperties: false,
};

const elapsed_seconds = (run: RunRecord) => {
  const started = Date.parse(run.started_at);
  const ended = run.ended_at ? Date.parse(run.ended_at) : Date.now();
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : 0;
};

const running_detail = (run: RunRecord): string => {
  const live = live_run(run.run_id);
  if (!live) {
    return "No live progress is available.";
  }
  const tools = live.transcript.steps.flatMap((step) => (step.kind === "tool" && step.name ? [step.name] : []));
  const latest = last_text(live.transcript).slice(-activity_chars);
  return [
    `Tool calls so far: ${tools.length}.${tools.length ? ` Most recent: ${tools.slice(-8).join(", ")}.` : ""}`,
    latest ? `Latest output: ${latest}` : "No text output yet.",
    "It is still working; its report arrives automatically when it finishes.",
  ].join("\n");
};

const describe = async (agent: AgentRecord, run: RunRecord): Promise<string> => {
  const head = `Agent ${agent.agent_id} ("${agent.name}"), ${agent.profile}, model ${agent.model}. Run ${run.run_id}: ${run.status} after ${elapsed_seconds(run)}s.`;
  if (run.status === "running") {
    return `${head}\n${running_detail(run)}`;
  }
  const file = await ensure_report_file(agent, run);
  return `${head}\n${report_file_notice(agent.agent_id, run.run_id, file)}`;
};

const latest = (agent: AgentRecord): RunRecord => {
  const run = current_run(agent);
  if (!run) {
    throw new Error(`Agent ${agent.agent_id} has no runs.`);
  }
  return run;
};

export const get_agent_status_tool = define_tool<{ agent_id: string }>({
  spec: {
    name: "get_agent_status",
    description:
      "Snapshot of an agent's latest run: status, runtime, tool calls, recent activity, and the complete report file path once it finished. Read or search the file with run_command when needed. It never waits; completion notifications arrive automatically, so do not poll it.",
    parameters: id_parameters,
  },
  profiles: ["main"],
  parse: (raw) => ({ agent_id: read_agent_id(raw) }),
  run: (ctx, args) =>
    guarded(ctx, "get_agent_status", async () => {
      const agent = resolve_agent(ctx, args.agent_id);
      const run = latest(agent);
      return { status: "done", text: await describe(agent, run), view: agent_view(agent, run) };
    }),
});

export const cancel_agent_tool = define_tool<{ agent_id: string }>({
  spec: {
    name: "cancel_agent",
    description:
      "Stop an agent's running run. Its transcript stays readable but no report comes back, and continue_agent can start it again later. Use it for an agent that is stuck or drifted, or whose work is no longer needed.",
    parameters: id_parameters,
  },
  profiles: ["main"],
  parse: (raw) => ({ agent_id: read_agent_id(raw) }),
  run: (ctx, args) =>
    guarded(ctx, "cancel_agent", async () => {
      const agent = resolve_agent(ctx, args.agent_id);
      const run = latest(agent);
      const text = cancel_agent(agent)
        ? `Cancelled agent ${agent.agent_id} ("${agent.name}"). No report will arrive from this run.`
        : `Agent ${agent.agent_id} is not running (${run.status}); nothing was stopped.`;
      return { status: "done", text, view: agent_view(agent, run) };
    }),
});

export const message_agent_tool = define_tool<{ agent_id: string; text: string }>({
  spec: {
    name: "message_agent",
    description:
      "Send an instruction to a running agent. It arrives at the start of the agent's next round, after the step it is on. Use it to narrow the scope, hand over a missing fact, or tell it to wrap up and report now.",
    parameters: {
      type: "object",
      properties: {
        agent_id: agent_id_property,
        text: { type: "string", description: "Concrete, self-contained instruction; the agent does not know what you are doing." },
      },
      required: ["agent_id", "text"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: (raw) => ({ agent_id: read_agent_id(raw), text: read_text(raw, "text", 4000) }),
  run: (ctx, args) =>
    guarded(ctx, "message_agent", async () => {
      const agent = resolve_agent(ctx, args.agent_id);
      const run = latest(agent);
      if (!message_agent(agent, args.text)) {
        return failed(`Agent ${agent.agent_id} is not running (${run.status}), so it cannot receive a message. Use continue_agent to start a new run on its kept context.`);
      }
      return { status: "done", text: `Queued for agent ${agent.agent_id}; it arrives at the start of the agent's next round.`, view: agent_view(agent, run) };
    }),
});
