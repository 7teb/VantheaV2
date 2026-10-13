import { roster_entries, roster_text } from "../../agents/roster.ts";
import { define_tool } from "../types.ts";

export const list_agents_tool = define_tool<Record<string, never>>({
  spec: {
    name: "list_agents",
    description:
      "List every agent of this chat: running agents with their short id (Name#xxxxxxxx), topic, scope, profile, model, start time, one-line task, files they wrote in their current run and open questions; finished agents with their status and end time. Agents with the same topic work on the same thing. Files an agent writes through run_command (formatters, generators) do not appear here. get_agent_status gives the full detail of one agent, including its messages and its report.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main", "explore", "worker"],
  parse: () => ({}),
  run: async (ctx) => {
    const self_id = ctx.review.actor.kind === "agent" ? ctx.review.actor.id : null;
    const text = roster_text(roster_entries(ctx.chat_id), self_id);
    return { status: "done", text, view: { kind: "text", text } };
  },
});
