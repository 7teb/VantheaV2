import assert from "node:assert/strict";
import type { AssistantMessage, Message, Step, ToolStep, TurnStatus, UserMessage } from "../shared/chat.ts";
import type { AgentRunStatus, AgentRunSummary, AgentSummary } from "../shared/ipc/work.ts";
import type { ToolView } from "../shared/tool-view.ts";
import type { WorkflowStatus } from "../shared/workflow.ts";
import { bundle, install_dom, stub_components, type FakeElement, type Vx } from "./dom-kit.ts";

const listeners = new Map<string, (payload: unknown) => void>();

const vx = {
  invoke: async () => undefined,
  on: (name: string, listener: (payload: unknown) => void) => {
    listeners.set(name, listener);
    return () => listeners.delete(name);
  },
  send: () => {},
} as unknown as Vx;

const element_stub = (name: string, block: string, id: string) =>
  `import { createElement } from "react"; export const ${name} = (props) => createElement("div", { "data-block": "${block}", "data-id": ${id} });`;

const stubs: Record<string, string> = {
  Markdown: 'import { createElement } from "react"; export const Markdown = (props) => createElement("div", { "data-block": "text" }, props.text);',
  WorkGroup: element_stub("WorkGroup", "work", "props.steps[0].id"),
  ReasoningRow: element_stub("ReasoningRow", "reasoning", "props.step.id"),
  PlanCard: element_stub("PlanCard", "plan", "props.message_id"),
  FileChanges: element_stub("FileChanges", "file_changes", "props.undo_id"),
  StepRows: [element_stub("SteerRow", "steer", "props.step.id"), element_stub("NoticeRow", "notice", "props.step.id").replace(/^import[^;]+;/, ""), element_stub("CompactionRow", "compaction", "props.step.id").replace(/^import[^;]+;/, "")].join(" "),
  "bodies-web": 'import { createElement } from "react"; export const ImageBody = () => createElement("div", { "data-block": "image" }); export const ShownImagesBody = () => createElement("div", { "data-block": "image" });',
  registry: "export const tool_icon = () => () => null;",
  MarkdownCopy: "export const CopyButton = () => null;",
};

export const start = Date.parse("2026-10-15T10:00:00.000Z");
export const at = (ms: number) => new Date(start + ms).toISOString();
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const tool = (id: string, name: string, ended: number | null, view: ToolView | null = null): ToolStep => ({
  id,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call_${id}`,
  name,
  args: {},
  status: ended === null ? "running" : "done",
  progress: null,
  approval: null,
  view,
  error: null,
  result_text: "ok",
  started_at: start,
  ended_at: ended === null ? null : start + ended,
});

export const reasoning = (id: string, ended: number | null, value = "thinking"): Step => ({ id, round: 1, kind: "reasoning", text: value, started_at: start, ended_at: ended === null ? null : start + ended });
export const text = (id: string, value: string): Step => ({ id, round: 1, kind: "text", text: value });
export const steer = (id: string): Step => ({ id, round: 2, kind: "steer", text: "also check the tests" });
export const notice = (id: string, kind: "context_trimmed" | "output_limit" = "context_trimmed"): Step => ({ id, round: 2, kind: "notice", notice: kind, text: "" });
export const image_view: ToolView = { kind: "image", images: [{ id: "img_1.png", width: 64, height: 64 }] };
export const plan_view: ToolView = { kind: "plan", text: "1. fix it" };

export const turn = (id: string, status: TurnStatus, steps: Step[], created_at = at(0), ended_at: string | null = status === "streaming" ? null : at(30_000)): AssistantMessage => ({
  id,
  role: "assistant",
  model: "test/model",
  effort: "high",
  mode: "ask",
  plan: false,
  created_at,
  ended_at,
  status,
  steps,
  reasoning_details: [],
  retry: null,
  error: status === "failed" ? { kind: "provider_unavailable", message: "" } : null,
  context: null,
  last_seq: 0,
});

export const long_turn = (): Step[] => [
  reasoning("r1", 2_000),
  text("t1", "Checking the parser"),
  tool("a1", "read_file", 4_000),
  steer("s1"),
  tool("a2", "run_command", 9_000),
  notice("n1"),
  tool("img", "generate_image", 10_000, image_view),
  tool("pl", "present_plan", 10_500, plan_view),
  text("t2", "All done."),
];

export const deployed = (id: string, chat_id = "c_agents"): Step[] =>
  [
    reasoning("r1", 1_000),
    tool("d1", "deploy_agent", 2_000, { kind: "agent", agent_id: "agent_reader", run_id: `run_${chat_id}`, name: "Reader", status: "running", report: "" }),
    text("t2", "The agent is reading the parser."),
  ].map((step) => ({ ...step, id: `${id}_${step.id}` }));

export const ran_workflow = (id: string, run_id: string): Step[] =>
  [
    reasoning("r1", 1_000),
    tool("w1", "run_workflow", 2_000, { kind: "workflow", run_id, name: "review-changes", status: "running", script_path: "C:/wf/script.js" }),
    text("t2", "The workflow reviews the changes."),
  ].map((step) => ({ ...step, id: `${id}_${step.id}` }));

const agent_run = (chat_id: string, status: AgentRunStatus): AgentRunSummary => ({
  run_id: `run_${chat_id}`,
  prompt: "read the parser",
  status,
  started_at: at(1_000),
  ended_at: null,
  report: "",
  open_questions: 0,
});

const agent = (chat_id: string, status: AgentRunStatus): AgentSummary => ({
  agent_id: "agent_reader",
  chat_id,
  name: "Reader",
  description: "",
  topic: "parser",
  model: "test/model",
  profile: "worker",
  without_tools: [],
  runs: [agent_run(chat_id, status)],
});

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

export const setup = async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  Object.assign(Reflect.get(globalThis, "window") as object, { setInterval, clearInterval });
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { AssistantMessage } from "./src/features/chat/AssistantMessage.tsx";',
      'export { agents_store } from "./src/state/agents.ts";',
      'export { workflows_store } from "./src/state/workflows.ts";',
      'export { chat_view_store, init_chat_view } from "./src/state/chat-view.ts";',
      'export { set_language } from "./src/i18n/index.ts";',
    ],
    [stub_components("TurnBody.tsx", stubs), stub_components("AssistantMessage.tsx", stubs)],
  );
  client.init_chat_view();
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
};

export const teardown = () => {
  root?.unmount();
  restore();
};

export const show_turn = (chat_id: string, messages: Message[] | null) =>
  client.flushSync(() =>
    root.render(
      messages &&
        client.createElement(client.AssistantMessage, {
          chat_id,
          messages,
          last_id: messages.at(-1)?.id ?? "",
          busy: false,
          last_plan_id: null,
          accepted: new Set(),
          undoable_id: null,
          summary_after: null,
        }),
    ),
  );

export const show = (chat_id: string, message: AssistantMessage | null) => show_turn(chat_id, message && [message]);

export const with_class = (name: string) => container.matching((element) => element.className.split(" ").includes(name));

export const head_text = () => with_class("turn-head")[0]?.textContent ?? null;

export const toggle = () => with_class("turn-toggle")[0] ?? null;

export const expanded = () => toggle()?.getAttribute("aria-expanded") ?? null;

const in_fold = (element: FakeElement) => {
  for (let node = element.parentNode; node; node = node.parentNode) {
    const parent = node as FakeElement;
    if (parent.getAttribute?.("data-folded") === "true") {
      return true;
    }
  }
  return false;
};

const blocks = () => container.matching((element) => element.getAttribute("data-block") !== null);

export const shown_with_class = (name: string) => with_class(name).filter((element) => !in_fold(element)).length;

export const visible = () => blocks().filter((element) => !in_fold(element)).map((element) => element.getAttribute("data-block"));

export const mounted = () => blocks().map((element) => element.getAttribute("data-block"));

export const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  const props = (element as unknown as Record<string, { onClick: (event: unknown) => void }>)[props_key];
  client.flushSync(() => props.onClick({ currentTarget: element }));
};

export const append = (chat_id: string, origin: UserMessage["origin"]) => {
  const message: UserMessage = { id: `u_${origin}_${Math.random()}`, role: "user", text: "next", attachments: [], origin, created_at: at(40_000) };
  client.flushSync(() => listeners.get("chats:appended")?.({ chat_id, message }));
};

export const open_chat = (chat_id: string, messages: Message[]) =>
  client.chat_view_store.set({
    entries: { [chat_id]: { status: "ready", chat: { id: chat_id, summary: null, messages, questions: {} }, held: [], waiting: {}, stale: false, context: null } },
    recent: [chat_id],
  });

export const agents = (chat_id: string, list_status: "loading" | "ready", run_status: AgentRunStatus) =>
  client.flushSync(() =>
    client.agents_store.set({
      chat_id,
      status: list_status,
      agents: list_status === "ready" ? [agent(chat_id, run_status)] : [],
      pending: list_status === "loading",
      held: [],
      transcript: null,
      known_runs: { [`run_${chat_id}`]: agent_run(chat_id, run_status) },
    }),
  );

export const language = (code: "en" | "de") => client.flushSync(() => client.set_language(code));

export const workflow = (chat_id: string, run_id: string, status: WorkflowStatus, list: "loading" | "ready" = "ready") =>
  client.flushSync(() =>
    client.workflows_store.set({
      chat_id,
      status: list,
      request: 1,
      pending: list === "loading",
      runs: list === "ready" ? { [run_id]: { run_id, chat_id, status, name: "review-changes", started_at: at(2_000), ended_at: status === "running" ? null : at(8_000), agents: [], logs: [], phases: [] } } : {},
      held: [],
      known: { [run_id]: status },
    }),
  );
