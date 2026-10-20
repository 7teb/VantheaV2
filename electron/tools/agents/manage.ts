import { agent_detail } from "../../agents/detail.ts";
import { reachable_live, unreachable_state } from "../../agents/live.ts";
import { current_run, type AgentRecord, type RunRecord } from "../../agents/records.ts";
import { cancel_agent, message_agent } from "../../agents/runner.ts";
import { failed, guarded, read_int_arg } from "../fs/common.ts";
import { define_tool } from "../types.ts";
import { agent_id_property, agent_view, read_agent_id, read_text, resolve_agent } from "./common.ts";

const id_parameters = {
  type: "object" as const,
  properties: { agent_id: agent_id_property },
  required: ["agent_id"],
  additionalProperties: false,
};

const latest = (agent: AgentRecord): RunRecord => {
  const run = current_run(agent);
  if (!run) {
    throw new Error(`Agent ${agent.agent_id} has no runs.`);
  }
  return run;
};

export const get_agent_status_tool = define_tool<{ agent_id: string; report_from: number }>({
  spec: {
    name: "get_agent_status",
    description:
      "Detail of one agent's latest run: status and runtime, topic and scope, the task, files read and written, every peer message it sent and received with the full text, open questions, recent activity while it runs, and its report once it finished. The main agent gets the path of the complete report file; a sub-agent gets the report text itself, in pages: when the report continues, the result names the report_from value for the rest. It never waits; completion notifications arrive automatically, so do not poll it.",
    parameters: {
      type: "object",
      properties: {
        agent_id: agent_id_property,
        report_from: { type: "integer", description: "Sub-agents only: the character offset of the report to continue from, as named at the end of the previous page. Default 0." },
      },
      required: ["agent_id"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "explore", "worker"],
  parse: (raw) => ({ agent_id: read_agent_id(raw), report_from: read_int_arg(raw, "report_from", 0, Number.MAX_SAFE_INTEGER) ?? 0 }),
  run: (ctx, args) =>
    guarded(ctx, "get_agent_status", async () => {
      const agent = resolve_agent(ctx, args.agent_id);
      const run = latest(agent);
      return { status: "done", text: await agent_detail(agent, run, ctx.profile, args.report_from), view: agent_view(agent, run) };
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

const not_running = (agent: AgentRecord) =>
  failed(`Agent ${agent.agent_id} ${unreachable_state(agent)}, so it cannot receive a message. Use continue_agent to start a new run on its kept context once it has ended.`);

export const message_agent_tool = define_tool<{ agent_id: string; text: string }>({
  spec: {
    name: "message_agent",
    description:
      "Send an instruction to a running agent. It arrives at the start of the agent's next round, after the step it is on. Use it to narrow the scope, hand over a missing fact, tell it to wrap up and report now, or step in when agents are stuck messaging each other.",
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
  parse: (raw) => ({ agent_id: read_agent_id(raw), text: read_text(raw, "text") }),
  run: (ctx, args) =>
    guarded(ctx, "message_agent", async () => {
      const agent = resolve_agent(ctx, args.agent_id);
      const run = latest(agent);
      if (!reachable_live(agent)) {
        return not_running(agent);
      }
      if (!message_agent(agent, args.text)) {
        return not_running(agent);
      }
      return { status: "done", text: `Queued for agent ${agent.agent_id}; it arrives at the start of the agent's next round.`, view: agent_view(agent, run) };
    }),
});
