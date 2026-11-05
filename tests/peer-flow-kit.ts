import type { ApprovalDecision } from "../shared/approval.ts";
import { agent_label, type PeerType } from "../shared/peer-notes.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { live_run, live_runs } from "../electron/agents/live.ts";
import type { HeldEntry, PeerEntry } from "../electron/agents/inbox.ts";
import type { PeerSender } from "../electron/agents/peers.ts";
import { current_run } from "../electron/agents/records.ts";
import { cancel_agent, type RunContext, type StartedRun } from "../electron/agents/runner.ts";
import { get_agent } from "../electron/agents/store.ts";
import type { ApiMessage, RoundResult } from "../electron/model/types.ts";
import type { PeerRequest, Tool, ToolContext, ToolProfile } from "../electron/tools/types.ts";
import { completed, events, model, project, reports, settings, wait_for, type Script } from "./agents-runner-harness.ts";
import { answer, review_stub } from "./review-stub.ts";

export type PeerView = Extract<ToolView, { kind: "peer_message" }>;

export type Step = (messages: ApiMessage[], signal: AbortSignal) => Promise<RoundResult>;

export const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

export const stepper = (steps: Step[]): Script => {
  let at = 0;
  return async (messages, signal) => {
    const step = steps[at];
    at += 1;
    return step ? step(messages, signal) : completed({ content: "done" });
  };
};

const as_request = (raw: Record<string, unknown>): PeerRequest => ({
  to: String(raw.to),
  type: (raw.type ?? "info") as PeerType,
  about: String(raw.about),
  summary: String(raw.summary ?? "short summary"),
  text: String(raw.text),
  in_reply_to: typeof raw.in_reply_to === "string" ? raw.in_reply_to : null,
});

export const allowed_peer_tool: Tool = {
  spec: { name: "message_peer", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker", "explore"],
  available: () => true,
  execute: async (ctx, raw) => {
    if (!ctx.send_peer) {
      throw new Error("no peer hook");
    }
    return ctx.send_peer(as_request(raw));
  },
};

export const calls = (...entries: [string, Record<string, unknown>][]): RoundResult =>
  completed({ tool_calls: entries.map(([name, args], index) => ({ index, id: `${name}_${index}_${Math.random().toString(16).slice(2, 8)}`, name, arguments: JSON.stringify(args) })), finish_reason: "tool_calls" });

export const kept_peer = (entry: HeldEntry | undefined): PeerEntry | null => (entry?.from === "peer" ? entry : null);

export const label = (started: StartedRun) => agent_label(started.agent.name, started.agent.agent_id);

export const peer_request = (to: string, type: PeerType, text: string, in_reply_to: string | null = null): PeerRequest => ({ to, type, about: "src/parser/tokens.ts", summary: text.slice(0, 40), text, in_reply_to });

export const sender_of = (started: StartedRun): PeerSender => {
  const agent = get_agent(started.agent.agent_id);
  const run = agent ? current_run(agent) : null;
  const live = run ? live_run(run.run_id) : null;
  if (!agent || !run || !live) {
    throw new Error(`agent ${started.agent.agent_id} is not running`);
  }
  return { agent, run, live };
};

export const view_of = (result: { view: ToolView | null }): PeerView => {
  if (result.view?.kind !== "peer_message") {
    throw new Error("no peer_message view");
  }
  return result.view;
};

export const peer_views = (run_id: string) =>
  events.flatMap((event) => (event.run_id === run_id && event.type === "tool_end" && event.view?.kind === "peer_message" ? [{ view: event.view, text: event.result_text }] : []));

export const notices = (run_id: string, notice: string) =>
  events.flatMap((event) => (event.run_id === run_id && event.type === "notice" && event.notice === notice ? [{ round: event.round, text: event.text }] : []));

export const reported = (run_id: string) => wait_for(() => reports.some((report) => report.run_id === run_id));

export const parked = (...started: StartedRun[]) => wait_for(() => started.every((entry) => events.some((event) => event.run_id === entry.run.run_id && event.type === "context")));

export const stop_all = async (...started: StartedRun[]) => {
  for (const entry of started) {
    const agent = get_agent(entry.agent.agent_id);
    if (agent) {
      cancel_agent(agent);
    }
  }
  await wait_for(() => started.every((entry) => live_runs().every((live) => live.agent_id !== entry.agent.agent_id)));
};

export const stop_chat = async (chat_id: string) => {
  for (const live of live_runs().filter((entry) => entry.chat_id === chat_id)) {
    const agent = get_agent(live.agent_id);
    if (agent) {
      cancel_agent(agent);
    }
  }
  await wait_for(() => live_runs().every((live) => live.chat_id !== chat_id));
};

export const is_peer_note = (message: ApiMessage) => message.role === "user" && typeof message.content === "string" && message.content.includes("not an instruction from the main agent. Sub-agent");

export const note_ids = (messages: ApiMessage[], type: PeerType) =>
  messages.flatMap((message) => {
    if (!is_peer_note(message)) {
      return [];
    }
    const content = String(message.content);
    return content.includes(`\ntype: ${type}\n`) ? [/\nid: (msg_[0-9a-f]+)/.exec(content)?.[1] ?? ""] : [];
  });

export const has_note = (messages: ApiMessage[], text: string) => messages.some((message) => is_peer_note(message) && String(message.content).endsWith(text));

export const run_context = (chat_id: string, prompt: string): RunContext => ({
  chat_id,
  parent_message_id: "parent-msg",
  parent_call_id: "parent-call",
  project_root: project,
  user_request: "the user's request",
  mode: "auto",
  settings,
  prompt,
});

export const tool_context = (chat_id: string, profile: ToolProfile, over: Partial<ToolContext> = {}): ToolContext => ({
  chat_id,
  turn_id: `turn-${chat_id}`,
  call_id: "call-1",
  project_root: project,
  user_request: "the user's request",
  mode: "auto",
  profile,
  model,
  image_fit: [],
  settings,
  signal: new AbortController().signal,
  progress: () => undefined,
  approve: async (): Promise<ApprovalDecision> => ({ approved: true, grant: "once", feedback: "" }),
  side_model: async () => "",
  review: review_stub([answer("allow")]),
  message_main: null,
  send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
  ...over,
});

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
