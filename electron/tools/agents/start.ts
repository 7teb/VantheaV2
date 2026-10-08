import type { AgentProfile } from "../../../shared/ipc/work.ts";
import { continue_agent, deploy_agent, find_agent_model } from "../../agents/runner.ts";
import { resolve_effort } from "../../model/catalog.ts";
import { active_turn } from "../../turn/active.ts";
import { read_string } from "../browser/common.ts";
import { guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { agent_id_property, agent_view, read_agent_id, read_text, resolve_agent, run_context } from "./common.ts";

type DeployArgs = { name: string; description: string; prompt: string; profile: AgentProfile; model: string | null; effort: string | null };

const prompt_chars = 100_000;

const one_line = (raw: Record<string, unknown>, key: string, max: number) => read_text(raw, key, 10_000).replace(/\s+/g, " ").slice(0, max);

const read_profile = (raw: Record<string, unknown>): AgentProfile => {
  if (raw.profile !== "explore" && raw.profile !== "worker") {
    throw new ToolArgumentError("profile must be explore or worker");
  }
  return raw.profile;
};

const parse_deploy = (raw: Record<string, unknown>): DeployArgs => ({
  name: one_line(raw, "name", 120),
  description: one_line(raw, "description", 240),
  prompt: read_text(raw, "prompt", prompt_chars),
  profile: read_profile(raw),
  model: read_string(raw, "model")?.trim() || null,
  effort: read_string(raw, "effort")?.trim() || null,
});

export const deploy_agent_tool = define_tool<DeployArgs>({
  spec: {
    name: "deploy_agent",
    description:
      "Start a focused sub-agent in the background and return at once. Use it when delegation has a real benefit: independent parts that can run in parallel, a large read-heavy exploration that would flood your context, a bounded implementation it can own, or an independent review of your work. Not for a quick lookup or a small edit. The agent has its own context, works under this chat's permission mode, cannot talk to the user and cannot deploy agents. While it runs it sends you short updates with confirmed results, which arrive at the start of your next round; do not redo work an update says it covers. If you need one result early, ask for it in the prompt, for example to message you the file that defines X as soon as it finds it. Its final report arrives automatically when it finishes.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name shown to the user." },
        description: { type: "string", description: "One line: what this agent is responsible for." },
        prompt: {
          type: "string",
          description: "Complete standalone task: the goal, relevant paths and facts, constraints, and what the report must contain. The agent knows nothing else about this chat.",
        },
        profile: {
          type: "string",
          enum: ["explore", "worker"],
          description: "explore is read-only and its file tools stay inside the project. worker can also edit files and run commands under the same permission checks as you, and is needed for anything outside the project folder.",
        },
        model: { type: "string", description: "Exact model id from list_models, which also shows each model's price per 1M tokens. Defaults to your own model." },
        effort: { type: "string", description: "Reasoning effort for that model. Defaults to yours." },
      },
      required: ["name", "description", "prompt", "profile"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_deploy,
  run: (ctx, args) =>
    guarded(ctx, "deploy_agent", async () => {
      const parent = active_turn(ctx.chat_id);
      if (!parent || parent.message_id !== ctx.turn_id) {
        throw new Error("Agents can only be deployed from a running turn of this chat.");
      }
      const model = args.model ? await find_agent_model(args.model) : parent.model;
      const effort = resolve_effort(model, args.effort ?? parent.effort);
      const started = deploy_agent({ ...run_context(ctx, args.prompt), name: args.name, description: args.description, profile: args.profile, model, effort });
      const id = started.agent.agent_id;
      return {
        status: "done",
        text: `Deployed agent ${id} ("${args.name}", ${args.profile}, model ${model.id}${effort ? `, effort ${effort}` : ""}). It runs in the background; its report arrives automatically when it finishes.`,
        view: agent_view(started.agent, started.run),
      };
    }),
});

export const continue_agent_tool = define_tool<{ agent_id: string; prompt: string }>({
  spec: {
    name: "continue_agent",
    description:
      "Start another background run of an existing agent on its kept context and return at once. Use it when the same agent benefits from what it already found. It keeps its name, profile and model. Its report arrives automatically when it finishes.",
    parameters: {
      type: "object",
      properties: {
        agent_id: agent_id_property,
        prompt: { type: "string", description: "The next complete instruction for this agent." },
      },
      required: ["agent_id", "prompt"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: (raw) => ({ agent_id: read_agent_id(raw), prompt: read_text(raw, "prompt", prompt_chars) }),
  run: (ctx, args) =>
    guarded(ctx, "continue_agent", async () => {
      const agent = resolve_agent(ctx, args.agent_id);
      const started = await continue_agent(agent, run_context(ctx, args.prompt));
      return {
        status: "done",
        text: `Started run ${started.run.run_id} of agent ${agent.agent_id} ("${agent.name}") on its kept context. Its report arrives automatically when it finishes.`,
        view: agent_view(agent, started.run),
      };
    }),
});
