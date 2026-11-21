import type { ApiEvent } from "../shared/api/contract.ts";
import { api_event_types } from "../shared/api/routes.ts";
import { error_text, send, type ClientConfig } from "./http.ts";

export type SseFrame = { id: string | null; event: string; data: string };

export type EventsOptions = { session_id?: string; last?: string; signal?: AbortSignal };

const known_types = new Set<string>(api_event_types);

const line_break = /\r\n|\r|\n/;

const field_of = (line: string): { name: string; value: string } => {
  const colon = line.indexOf(":");
  if (colon < 0) {
    return { name: line, value: "" };
  }
  const value = line.slice(colon + 1);
  return { name: line.slice(0, colon), value: value.startsWith(" ") ? value.slice(1) : value };
};

export const parse_sse = async function* (chunks: AsyncIterable<Uint8Array | string>): AsyncGenerator<SseFrame, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = "";
  let id: string | null = null;
  let event = "";
  let data: string[] = [];
  let has_fields = false;
  for await (const chunk of chunks) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const held = buffer.endsWith("\r") ? 1 : 0;
    const lines = buffer.slice(0, buffer.length - held).split(line_break);
    buffer = (lines.pop() ?? "") + buffer.slice(buffer.length - held);
    for (const line of lines) {
      if (line === "") {
        if (has_fields) {
          yield { id, event: event || "message", data: data.join("\n") };
        }
        id = null;
        event = "";
        data = [];
        has_fields = false;
        continue;
      }
      if (line.startsWith(":")) {
        continue;
      }
      const field = field_of(line);
      if (field.name === "data") {
        data.push(field.value);
        has_fields = true;
      } else if (field.name === "event") {
        event = field.value;
        has_fields = true;
      } else if (field.name === "id" && !field.value.includes("\0")) {
        id = field.value;
      }
    }
  }
};

export const to_api_event = (frame: SseFrame): ApiEvent | null => {
  if (!known_types.has(frame.event)) {
    return null;
  }
  const data: unknown = frame.data ? JSON.parse(frame.data) : null;
  return { type: frame.event, id: frame.id || null, data } as ApiEvent;
};

export const events = async function* (config: ClientConfig, options: EventsOptions = {}): AsyncGenerator<ApiEvent, void, undefined> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abort();
  }
  options.signal?.addEventListener("abort", abort, { once: true });
  let last = options.last;
  let dropped: unknown = null;
  try {
    for (;;) {
      const response = await send(config, "events", {}, { query: { session: options.session_id, last }, signal: controller.signal }).catch((error: unknown) => {
        if (dropped === null || controller.signal.aborted) {
          throw error;
        }
        throw new Error(`the event stream dropped (${error_text(dropped)}) and reconnecting failed: ${error_text(error)}`, { cause: error });
      });
      if (!response.body) {
        throw new Error("the event stream response has no body");
      }
      dropped = null;
      const frames = parse_sse(response.body)[Symbol.asyncIterator]();
      try {
        for (;;) {
          let next: IteratorResult<SseFrame, void>;
          try {
            next = await frames.next();
          } catch (error) {
            if (controller.signal.aborted) {
              throw error;
            }
            dropped = error;
            break;
          }
          if (next.done) {
            dropped = new Error("the server closed the event stream");
            break;
          }
          if (next.value.id) {
            last = next.value.id;
          }
          const event = to_api_event(next.value);
          if (event) {
            yield event;
          }
        }
      } finally {
        await frames.return?.();
      }
      if (controller.signal.aborted) {
        throw controller.signal.reason;
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", abort);
    controller.abort();
  }
};
