import path from "node:path";
import type { AgentProfile } from "../../../shared/ipc/work.ts";
import type { AgentRecord } from "../../agents/records.ts";
import { label_of, roster_entries } from "../../agents/roster.ts";
import { continue_agent, deploy_agent, ensure_capacity, ensure_continuable, find_agent_model } from "../../agents/runner.ts";
import { resolve_effort } from "../../model/catalog.ts";
import { active_turn } from "../../turn/active.ts";
import { read_string } from "../browser/common.ts";
import { guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { read_string_list } from "../web/args.ts";
import { agent_id_property, agent_view, read_agent_id, read_text, resolve_agent, run_context } from "./common.ts";
import { agent_text_gate, agent_text_subject } from "./text-gate.ts";

type DeployArgs = { name: string; description: string; topic: string; scope: string[]; prompt: string; profile: AgentProfile; model: string | null; effort: string | null };

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
  topic: read_text(raw, "topic").replace(/\s+/g, " "),
  scope: read_string_list(raw, "scope"),
  prompt: read_text(raw, "prompt"),
  profile: read_profile(raw),
  model: read_string(raw, "model")?.trim() || null,
  effort: read_string(raw, "effort")?.trim() || null,
});

const scope_entry = (project_root: string, value: string): string => {
  const relative = path.isAbsolute(value) ? path.relative(project_root, value) : value;
  const inside = !relative.startsWith("..") && !path.isAbsolute(relative);
  const shown = (inside || !path.isAbsolute(value) ? relative : value).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return shown || ".";
};

const running_peers = (chat_id: string, except: string): string => {
  const running = roster_entries(chat_id).filter((entry) => entry.running && entry.agent.agent_id !== except);
  if (!running.length) {
    return "No other agent of this chat is running.";
  }
  return `Running agents of this chat: ${running.map((entry) => `${label_of(entry.agent)} (topic ${entry.agent.topic || "none"})`).join(", ")}. Give related work the same topic word so those agents coordinate directly.`;
};

const task_subject = (head: string, agent: Pick<AgentRecord, "topic" | "scope">, prompt: string) =>
  agent_text_subject([head, `topic ${agent.topic || "none"}`, `scope ${agent.scope.join(", ") || "none"}`, "the task"], prompt);

export const deploy_agent_tool = define_tool<DeployArgs>({
  spec: {
    name: "deploy_agent",
    description:
      "Start a focused sub-agent in the background and return at once. Use it when delegation has a real benefit: independent parts that can run in parallel, a large read-heavy exploration that would flood your context, a bounded implementation it can own, or an independent review of your work. Not for a quick lookup or a small edit. The agent has its own context, works under this chat's permission mode, cannot talk to the user and cannot deploy agents. Give every agent a topic: agents with the same topic are a team, see each other as such and coordinate directly with message_peer, so give related work the same topic word and unrelated work different ones. Name the files or folders it owns in scope, and say in the prompt what other agents own, so work is not done twice. The automatic review checks the task before the agent starts. While it runs it sends you short updates with confirmed results, which arrive at the start of your next round; do not redo work an update says it covers. If you need one result early, ask for it in the prompt, for example to message you the file that defines X as soon as it finds it. Its final report arrives automatically when it finishes.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name shown to the user." },
        description: { type: "string", description: "One line: what this agent is responsible for." },
        topic: { type: "string", description: "One word or short phrase for the area of work, for example parser or auth tests. Agents with the same topic coordinate directly; reuse the topic of running agents for related work." },
        scope: { type: "array", items: { type: "string" }, description: "Optional project paths (files or folders) this agent owns or works in. Agents whose scopes or written files overlap are introduced to each other." },
        prompt: {
          type: "string",
          description: "Complete standalone task: the goal, relevant paths and facts, what other agents own, constraints, and what the report must contain. The agent knows nothing else about this chat.",
        },
        profile: {
          type: "string",
          enum: ["explore", "worker"],
          description: "explore is read-only and its file tools stay inside the project. worker can also edit files and run commands under the same permission checks as you, and is needed for anything outside the project folder. Neither profile has MCP or browser tools; keep that work yourself.",
        },
        model: { type: "string", description: "Exact model id from list_models, which also shows each model's price per 1M tokens. Defaults to your own model." },
        effort: { type: "string", description: "Reasoning effort for that model. Defaults to yours." },
      },
      required: ["name", "description", "topic", "prompt", "profile"],
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
      ensure_capacity(ctx.chat_id);
      const model = args.model ? await find_agent_model(args.model) : parent.model;
      const effort = resolve_effort(model, args.effort ?? parent.effort);
      const scope = args.scope.map((entry) => scope_entry(ctx.project_root, entry));
      const subject = task_subject(`deploy_agent, new sub-agent ${args.name}, profile ${args.profile}, model ${model.id}`, { topic: args.topic, scope }, args.prompt);
      const gate = await agent_text_gate(ctx, { tool: "deploy_agent", to_name: args.name, to_id: null, about: args.topic, text: args.prompt }, subject);
      if (gate.kind !== "pass") {
        return { status: "denied", text: gate.text, view: null };
      }
      const started = deploy_agent({ ...run_context(ctx, args.prompt), name: args.name, description: args.description, topic: args.topic, scope, profile: args.profile, model, effort });
      const id = started.agent.agent_id;
      return {
        status: "done",
        text: `Deployed agent ${label_of(started.agent)} (id ${id}, ${args.profile}, model ${model.id}${effort ? `, effort ${effort}` : ""}, topic ${args.topic}). It runs in the background; its report arrives automatically when it finishes. ${running_peers(ctx.chat_id, id)}`,
        view: agent_view(started.agent, started.run),
      };
    }),
});

export const continue_agent_tool = define_tool<{ agent_id: string; prompt: string }>({
  spec: {
    name: "continue_agent",
    description:
      "Start another background run of an existing agent on its kept context and return at once. Use it when the same agent benefits from what it already found, or to deliver answers other agents sent it after it finished and message_agent instructions it had not read when the app closed: they are kept, list_agents and get_agent_status show them, and they arrive at the start of the new run. It keeps its name, topic, scope, profile and model. The automatic review checks the task before the run starts. Its report arrives automatically when it finishes.",
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
  parse: (raw) => ({ agent_id: read_agent_id(raw), prompt: read_text(raw, "prompt") }),
  run: (ctx, args) =>
    guarded(ctx, "continue_agent", async () => {
      const agent = resolve_agent(ctx, args.agent_id);
      ensure_continuable(agent, ctx.project_root);
      ensure_capacity(agent.chat_id);
      const subject = task_subject(`continue_agent, sub-agent ${label_of(agent)}, profile ${agent.profile}, model ${agent.model}`, agent, args.prompt);
      const gate = await agent_text_gate(ctx, { tool: "continue_agent", to_name: label_of(agent), to_id: agent.agent_id, about: agent.topic, text: args.prompt }, subject);
      if (gate.kind !== "pass") {
        return { status: "denied", text: gate.text, view: null };
      }
      const peers = agent.held.filter((entry) => entry.from === "peer").length;
      const instructions = agent.held.length - peers;
      const started = await continue_agent(agent, run_context(ctx, args.prompt));
      const kept = [
        ...(peers ? [` ${peers} kept peer message(s) arrive at the start of this run.`] : []),
        ...(instructions ? [` ${instructions} instruction(s) of yours that it had not read when the app closed arrive before this task.`] : []),
      ].join("");
      return {
        status: "done",
        text: `Started run ${started.run.run_id} of agent ${agent.agent_id} ("${agent.name}") on its kept context.${kept} Its report arrives automatically when it finishes.`,
        view: agent_view(agent, started.run),
      };
    }),
});
