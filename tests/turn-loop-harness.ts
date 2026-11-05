import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before } from "node:test";
import type { AssistantMessage, Attachment, PermissionMode, SteerMessage } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { Settings } from "../shared/settings.ts";
import { apply_events } from "../shared/apply-event.ts";
import { init_media } from "../electron/media/files.ts";
import type { ApiMessage, RoundResult } from "../electron/model/types.ts";
import type { Tool } from "../electron/tools/types.ts";
import type { StreamFn, TurnSession } from "../electron/turn/session.ts";
import { review_stub } from "./review-stub.ts";

export const use_media_root = () => {
  let media_root = "";
  before(async () => {
    media_root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-turn-loop-"));
    init_media({ attachments: path.join(media_root, "attachments"), images: path.join(media_root, "images") });
  });
  after(async () => {
    await fs.rm(media_root, { recursive: true, force: true });
  });
};

export const model: ModelEntry = {
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: false,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
};

export const completed = (over: Partial<RoundResult>): RoundResult => ({
  status: "completed",
  content: "",
  reasoning: "",
  reasoning_details: [],
  tool_calls: [],
  finish_reason: "stop",
  usage: null,
  ...over,
});

export const tool_call = (name: string) => ({ index: 0, id: "p0", name, arguments: "{}" });

export const make_tool = (name: string, run: Tool["execute"]): Tool => ({
  spec: { name, description: "", parameters: { type: "object", properties: {} } },
  profiles: ["main", "plan"],
  available: () => true,
  execute: run,
});

export type Harness = { session: TurnSession; events: StreamEventBody[]; controller: AbortController; messages: ApiMessage[] };

export const harness = (stream: StreamFn, tools: Tool[], plan = false): Harness => {
  const controller = new AbortController();
  const events: StreamEventBody[] = [];
  const session: TurnSession = {
    compaction: { audience: "user", facts: async () => "" },
    chat_id: "c",
    message_id: "m",
    user_request: "go",
    project_root: "C:/p",
    settings: {} as Settings,
    model,
    effort: "high",
    mode: "auto" as PermissionMode,
    plan,
    signal: controller.signal,
    emit: (body) => events.push(body),
    stream,
    resolve_tools: () => tools,
    side_model: async () => "",
    review: review_stub(),
    wait_decision: async () => ({ approved: true, grant: "once", feedback: "" }),
  };
  return { session, events, controller, messages: [{ role: "system", content: "s" }] };
};

export const queue_steers = (h: Harness, noted: (steer: SteerMessage) => Promise<Attachment[]> = async (steer) => steer.attachments) => {
  const steers: SteerMessage[] = [];
  let sequence = 0;
  h.session.steers = {
    next: () => steers[0] ?? null,
    noted,
    take: (steer_id) => {
      const at = steers.findIndex((steer) => steer.id === steer_id);
      if (at >= 0) {
        steers.splice(at, 1);
      }
    },
  };
  return { queued: steers, push: (text: string, attachments: Attachment[] = []) => steers.push({ id: `steer-${sequence++}`, text, at: 1, attachments }) };
};

export const ends = (events: StreamEventBody[]) => events.filter((event) => event.type === "end");

export const transcript = (events: StreamEventBody[]): AssistantMessage =>
  apply_events(
    {
      id: "m",
      role: "assistant",
      model: "m",
      effort: "high",
      mode: "auto",
      plan: false,
      created_at: "2026-10-06T10:00:00.000Z",
      ended_at: null,
      status: "streaming",
      steps: [],
      reasoning_details: [],
      retry: null,
      error: null,
      context: null,
      last_seq: 0,
    },
    events.map((body, index) => ({ ...body, seq: index + 1, at: index + 1 })),
  );
