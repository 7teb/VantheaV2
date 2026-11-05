import assert from "node:assert/strict";
import type { StreamEventBody } from "../shared/events.ts";
import type { ApiMessage, RoundToolCall } from "../electron/model/types.ts";
import type { Tool, ToolResult } from "../electron/tools/types.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import { completed, make_tool, type Harness } from "./turn-loop-harness.ts";

export const done = (text: string, extra: Partial<ToolResult> = {}): ToolResult => ({ status: "done", text, view: null, ...extra });

export const parallel = (name: string, run: Tool["execute"]): Tool => ({ ...make_tool(name, run), concurrent: true });

export const calls_of = (entries: (string | [string, string])[]): RoundToolCall[] =>
  entries.map((entry, index) => {
    const [name, args] = typeof entry === "string" ? [entry, "{}"] : entry;
    return { index, id: `p${index}`, name, arguments: args };
  });

export const scripted = (first: RoundToolCall[]) => {
  const requests: ApiMessage[][] = [];
  const stream: StreamFn = async (request, callbacks) => {
    requests.push(structuredClone(request.messages));
    if (requests.length === 1) {
      return completed({ tool_calls: first, finish_reason: "tool_calls" });
    }
    callbacks.on_text("done");
    return completed({ content: "done" });
  };
  return { stream, requests };
};

export const ended = (call_id: string) => (event: StreamEventBody) => event.type === "tool_end" && event.call_id === call_id;

export const asked = (call_id: string) => (event: StreamEventBody) => event.type === "tool_approval" && event.call_id === call_id;

export const watch = (h: Harness) => {
  const waiters: { check: (event: StreamEventBody) => boolean; resolve: () => void }[] = [];
  const emit = h.session.emit;
  h.session.emit = (body) => {
    emit(body);
    for (const waiter of waiters.filter((entry) => entry.check(body))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  return (check: (event: StreamEventBody) => boolean) =>
    new Promise<void>((resolve) => {
      if (h.events.some(check)) {
        resolve();
        return;
      }
      waiters.push({ check, resolve });
    });
};

export const marks = (events: StreamEventBody[]): string[] =>
  events.flatMap((event) => (event.type === "tool_start" || event.type === "tool_end" ? [`${event.type === "tool_start" ? "start" : "end"}:${event.call_id}`] : []));

export const end_status = (events: StreamEventBody[], call_id: string) => {
  const event = events.find(ended(call_id));
  return event?.type === "tool_end" ? event.status : null;
};

export const assert_tool_protocol = (messages: ApiMessage[]) => {
  const asked_ids: string[] = [];
  for (const [at, message] of messages.entries()) {
    if (message.role === "tool") {
      const owner = messages.slice(0, at).findLast((entry) => entry.role !== "tool");
      assert.ok(owner?.role === "assistant" && owner.tool_calls?.some((call) => call.id === message.tool_call_id), `tool message ${message.tool_call_id} at ${at} does not follow its assistant message`);
      continue;
    }
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      continue;
    }
    const ids = message.tool_calls.map((call) => call.id);
    asked_ids.push(...ids);
    const answers = messages.slice(at + 1, at + 1 + ids.length).map((entry) => (entry.role === "tool" ? entry.tool_call_id : `<${entry.role}>`));
    assert.deepEqual(answers, ids, `assistant message at ${at} is not answered right after it, in tool_calls order`);
    assert.notEqual(messages[at + 1 + ids.length]?.role, "tool", `assistant message at ${at} has more tool messages than calls`);
  }
  const answered = messages.flatMap((message) => (message.role === "tool" ? [message.tool_call_id] : []));
  assert.equal(new Set(answered).size, answered.length, "a tool call id is answered twice");
  assert.deepEqual(answered, asked_ids);
};

export const tool_contents = (messages: ApiMessage[]) => messages.flatMap((message) => (message.role === "tool" ? [message.content] : []));
