import type { Step, ToolStep } from "./chat.ts";
import type { Sequenced, StreamEventBody, TranscriptState } from "./events.ts";

type Event = Sequenced & StreamEventBody;

const open_tool_statuses = new Set<ToolStep["status"]>(["queued", "running", "awaiting_approval"]);

const close_reasoning = (steps: Step[], at: number): Step[] =>
  steps.some((step) => step.kind === "reasoning" && step.ended_at === null)
    ? steps.map((step) => (step.kind === "reasoning" && step.ended_at === null ? { ...step, ended_at: at } : step))
    : steps;

const update_tool = (steps: Step[], match: (step: ToolStep) => boolean, patch: (step: ToolStep) => ToolStep): Step[] =>
  steps.map((step) => (step.kind === "tool" && match(step) ? patch(step) : step));

const has_tool = (steps: Step[], match: (step: ToolStep) => boolean) => steps.some((step) => step.kind === "tool" && match(step));

const empty_tool = (round: number, index: number): ToolStep => ({
  id: `tool:${round}:${index}`,
  round,
  kind: "tool",
  index,
  call_id: "",
  name: "",
  args: {},
  status: "drafting",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text: "",
  started_at: null,
  ended_at: null,
});

const append_text = (steps: Step[], event: Extract<Event, { type: "text" }>): Step[] => {
  const last = steps.at(-1);
  if (last?.kind === "text" && last.round === event.round) {
    return [...steps.slice(0, -1), { ...last, text: last.text + event.delta }];
  }
  return [...steps, { id: `text:${event.seq}`, round: event.round, kind: "text", text: event.delta }];
};

const append_reasoning = (steps: Step[], event: Extract<Event, { type: "reasoning" }>): Step[] => {
  const last = steps.at(-1);
  if (last?.kind === "reasoning" && last.round === event.round && last.ended_at === null) {
    return [...steps.slice(0, -1), { ...last, text: last.text + event.delta }];
  }
  return [
    ...steps,
    { id: `reasoning:${event.seq}`, round: event.round, kind: "reasoning", text: event.delta, started_at: event.at, ended_at: null },
  ];
};

const drop_attempt = (steps: Step[], round: number): Step[] =>
  steps.filter((step) => {
    if (step.round !== round) {
      return true;
    }
    if (step.kind === "text" || step.kind === "reasoning") {
      return false;
    }
    return !(step.kind === "tool" && step.status === "drafting");
  });

const settle_step = (step: Step, at: number): Step => {
  if (step.kind === "tool" && open_tool_statuses.has(step.status)) {
    return { ...step, status: "cancelled", approval: null, ended_at: at };
  }
  if (step.kind === "compaction" && step.status === "running") {
    return { ...step, status: "failed" };
  }
  return step;
};

const settle_steps = (steps: Step[], at: number): Step[] =>
  close_reasoning(steps, at)
    .filter((step) => !(step.kind === "tool" && step.status === "drafting"))
    .map((step) => settle_step(step, at));

const apply_body = <T extends TranscriptState>(state: T, event: Event): T => {
  switch (event.type) {
    case "text":
      return event.delta ? { ...state, retry: null, steps: append_text(close_reasoning(state.steps, event.at), event) } : state;
    case "reasoning":
      return event.delta ? { ...state, retry: null, steps: append_reasoning(state.steps, event) } : state;
    case "reasoning_details":
      return {
        ...state,
        reasoning_details: [...state.reasoning_details.filter((entry) => entry.round !== event.round), { round: event.round, details: event.details }],
      };
    case "retry":
      return {
        ...state,
        steps: drop_attempt(state.steps, event.round),
        retry: { attempt: event.attempt, max: event.max, reason: event.reason, until: event.at + event.wait_ms },
      };
    case "tool_draft": {
      const match = (step: ToolStep) => step.round === event.round && step.index === event.index;
      const steps = close_reasoning(state.steps, event.at);
      const base = has_tool(steps, match) ? steps : [...steps, empty_tool(event.round, event.index)];
      return {
        ...state,
        retry: null,
        steps: update_tool(base, match, (step) => ({
          ...step,
          name: event.name || step.name,
          progress: { label: "", lines: event.lines, output_tail: null },
        })),
      };
    }
    case "tool_call": {
      const match = (step: ToolStep) => step.round === event.round && step.index === event.index;
      const steps = close_reasoning(state.steps, event.at);
      const base = has_tool(steps, match) ? steps : [...steps, empty_tool(event.round, event.index)];
      return {
        ...state,
        retry: null,
        steps: update_tool(base, match, (step) => ({
          ...step,
          call_id: event.call_id,
          name: event.name,
          args: event.args,
          status: "queued",
          progress: null,
        })),
      };
    }
    case "tool_start":
      return {
        ...state,
        steps: update_tool(
          state.steps,
          (step) => step.call_id === event.call_id,
          (step) => ({ ...step, status: "running", approval: null, started_at: step.started_at ?? event.at }),
        ),
      };
    case "tool_progress":
      return {
        ...state,
        steps: update_tool(state.steps, (step) => step.call_id === event.call_id, (step) => ({ ...step, progress: event.progress })),
      };
    case "tool_approval":
      return {
        ...state,
        steps: update_tool(
          state.steps,
          (step) => step.call_id === event.call_id,
          (step) => ({ ...step, status: "awaiting_approval", approval: event.request }),
        ),
      };
    case "tool_decision":
      return {
        ...state,
        steps: update_tool(state.steps, (step) => step.call_id === event.call_id, (step) => ({
          ...step,
          decisions: [...(step.decisions ?? []).filter((entry) => entry.id !== event.decision.id), event.decision],
        })),
      };
    case "tool_end":
      return {
        ...state,
        steps: update_tool(
          state.steps,
          (step) => step.call_id === event.call_id,
          (step) => ({
            ...step,
            status: event.status,
            view: event.view,
            error: event.error,
            result_text: event.result_text,
            approval: null,
            progress: null,
            ended_at: event.at,
          }),
        ),
      };
    case "steer":
      return {
        ...state,
        steps: [
          ...close_reasoning(state.steps, event.at),
          {
            id: `steer:${event.seq}`,
            round: event.round,
            kind: "steer",
            text: event.text,
            ...(event.steer_id ? { steer_id: event.steer_id } : {}),
            ...(event.attachments?.length ? { attachments: event.attachments } : {}),
            ...(event.assistant_reference ? { assistant_reference: event.assistant_reference } : {}),
          },
        ],
      };
    case "notice":
      return {
        ...state,
        steps: [
          ...close_reasoning(state.steps, event.at),
          { id: `notice:${event.seq}`, round: event.round, kind: "notice", notice: event.notice, text: event.text },
        ],
      };
    case "compaction": {
      const id = `compaction:${event.round}`;
      const step: Step = { id, round: event.round, kind: "compaction", status: event.status, summary: event.summary };
      const exists = state.steps.some((entry) => entry.id === id);
      return { ...state, steps: exists ? state.steps.map((entry) => (entry.id === id ? step : entry)) : [...state.steps, step] };
    }
    case "context":
      return { ...state, context: event.usage };
    case "end":
      return {
        ...state,
        status: event.status,
        error: event.error,
        retry: null,
        ended_at: new Date(event.at).toISOString(),
        steps: settle_steps(state.steps, event.at),
      };
  }
  return state;
};

export const apply_event = <T extends TranscriptState>(state: T, event: Event): T => {
  if (event.seq <= state.last_seq) {
    return state;
  }
  return { ...apply_body(state, event), last_seq: event.seq };
};

export const apply_events = <T extends TranscriptState>(state: T, events: Event[]): T =>
  events.reduce((current, event) => apply_event(current, event), state);
