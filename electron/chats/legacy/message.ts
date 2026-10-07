import { randomUUID } from "node:crypto";
import type {
  AssistantMessage,
  Attachment,
  Chat,
  ChatSummary,
  Message,
  Step,
  TurnError,
  TurnErrorKind,
  TurnStatus,
  UserMessage,
  UserOrigin,
} from "../../../shared/chat.ts";
import { is_media_id, media_mime } from "../../media/files.ts";
import type { LegacyMediaRef } from "../../media/legacy.ts";
import { as_array, as_iso, as_number, as_record, as_string, is_record } from "../../storage/coerce.ts";
import { chat_id_pattern } from "../files.ts";
import { interrupt_message } from "../settle.ts";
import { legacy_tool_step, type StepContext } from "./tools.ts";
import { shorten } from "./views.ts";
import { legacy_workspace } from "./workspace.ts";

type Raw = Record<string, unknown>;

export type LegacyChatImport = { chat: Chat; media: LegacyMediaRef[] };

const continue_prefix = "Continue the previous turn from where it was interrupted.";
const plan_suffix = "Implement this plan now. Write the files and make the changes.";

const interruption_kinds: Record<string, TurnErrorKind> = {
  app_restart: "app_closed",
  stream_interrupted: "stream_interrupted",
  first_event_timeout: "timeout",
  stream_idle_timeout: "timeout",
  provider_unavailable: "provider_unavailable",
  rate_limited: "rate_limited",
  context_limit: "context_limit",
};

const interruption_kind = (value: unknown): TurnErrorKind => {
  const key = as_string(value);
  return Object.hasOwn(interruption_kinds, key) ? interruption_kinds[key] : "stream_interrupted";
};

const user_origin = (text: string): UserOrigin => {
  if (text.startsWith(continue_prefix)) {
    return "continue";
  }
  if (text.trimEnd().endsWith(plan_suffix)) {
    return "plan_accept";
  }
  return "user";
};

const legacy_attachment = (value: unknown, media: LegacyMediaRef[]): Attachment | null => {
  const raw = as_record(value);
  const name = as_string(raw.name);
  if (!is_media_id(name) || raw.generated === true || raw.kind === "video") {
    return null;
  }
  media.push({ bucket: "attachment", name });
  if (raw.kind === "file") {
    return { id: name, kind: "file", name: as_string(raw.displayName) || name, mime: "text/plain", size: as_number(raw.size, 0), vision_note: null };
  }
  return { id: name, kind: "image", name, mime: media_mime(name), size: as_number(raw.size, 0), vision_note: as_string(raw.analysis) || null };
};

const legacy_user = (raw: Raw, id: string, created_at: string, media: LegacyMediaRef[]): UserMessage => {
  const text = as_string(raw.content);
  const listed = Array.isArray(raw.attachments) ? raw.attachments : [raw.attachment].filter(Boolean);
  return {
    id,
    role: "user",
    text,
    attachments: listed.flatMap((entry) => legacy_attachment(entry, media) ?? []),
    origin: user_origin(text),
    created_at,
  };
};

const text_step = (text: string, round: number, position: number): Step => ({ id: `text:${position}`, round, kind: "text", text });

const legacy_steps = (raw: Raw, ctx: StepContext): Step[] => {
  const tools = as_array(raw.tools).map(as_record);
  const latest = new Map(tools.map((tool) => [as_string(tool.id), tool]));
  const segments = as_array(raw.segments).map(as_record);
  const used = new Set<string>();
  const steps: Step[] = [];
  let round = 0;
  let previous = "";
  const add_text = (text: string) => {
    if (previous === "tool") {
      round += 1;
    }
    steps.push(text_step(text, round, steps.length));
    previous = "text";
  };
  const add_tool = (tool: Raw) => {
    steps.push(legacy_tool_step(tool, round, steps.length, ctx));
    previous = "tool";
  };
  for (const segment of segments) {
    if (segment.type === "text" && as_string(segment.content).trim()) {
      add_text(as_string(segment.content));
    } else if (segment.type === "tool") {
      const tool = as_record(segment.tool);
      const id = as_string(tool.id);
      used.add(id);
      add_tool((id && latest.get(id)) || tool);
    } else if (segment.type === "steer" && as_string(segment.text).trim()) {
      steps.push({ id: `steer:${steps.length}`, round, kind: "steer", text: as_string(segment.text) });
    }
  }
  for (const tool of tools) {
    const id = as_string(tool.id);
    if (!segments.length || (id && !used.has(id))) {
      add_tool(tool);
    }
  }
  const content = as_string(raw.content);
  if (content.trim() && !steps.some((step) => step.kind === "text")) {
    add_text(content);
  }
  return steps;
};

const legacy_outcome = (raw: Raw): { status: TurnStatus; error: TurnError | null } => {
  if (raw.error === true) {
    return { status: "failed", error: { kind: "internal", message: shorten(as_string(raw.content), 2000) } };
  }
  if (raw.done === false) {
    return { status: "streaming", error: null };
  }
  if (is_record(raw.policy)) {
    return { status: "blocked", error: { kind: "policy", message: as_string(raw.policy.message) } };
  }
  if (raw.cancelled === true) {
    return { status: "stopped", error: null };
  }
  if (raw.interrupted === true) {
    const interruption = as_record(raw.interruption);
    return { status: "interrupted", error: { kind: interruption_kind(interruption.kind), message: as_string(interruption.message) } };
  }
  return { status: "done", error: null };
};

const legacy_assistant = (raw: Raw, id: string, created_at: string, ctx: StepContext): AssistantMessage => {
  const ended = Date.parse(created_at) + Math.max(0, as_number(raw.workMs, 0));
  const outcome = legacy_outcome(raw);
  const steps = outcome.status === "failed" ? [] : legacy_steps(raw, ctx);
  const message: AssistantMessage = {
    id,
    role: "assistant",
    model: as_string(raw.model),
    effort: "",
    mode: "auto",
    plan: steps.some((step) => step.kind === "tool" && step.view?.kind === "plan"),
    created_at,
    ended_at: outcome.status === "streaming" ? null : new Date(ended).toISOString(),
    status: outcome.status,
    steps,
    reasoning_details: [],
    retry: null,
    error: outcome.error,
    context: null,
    last_seq: 0,
  };
  return outcome.status === "streaming" ? interrupt_message(message, ended) : message;
};

const step_context = (project_path: string, media: LegacyMediaRef[]): StepContext => {
  const call_ids = new Set<string>();
  return {
    project_path,
    image: (name) => {
      media.push({ bucket: "image", name });
      return name;
    },
    call_id: (legacy_id) => {
      const id = legacy_id && !call_ids.has(legacy_id) ? legacy_id : `legacy_call_${call_ids.size}`;
      call_ids.add(id);
      return id;
    },
  };
};

const legacy_summary = (raw: Raw, ids: string[]): ChatSummary | null => {
  const text = as_string(raw.summary).trim();
  const count = Math.floor(as_number(raw.summaryCount, 0));
  const through = count > 0 ? ids[Math.min(count, ids.length) - 1] : undefined;
  return text && through ? { text, through_message_id: through } : null;
};

export const convert_legacy_chat = (value: unknown, now: string, legacy_root: string): LegacyChatImport => {
  const raw = as_record(value);
  const legacy_id = as_string(raw.id);
  if (!legacy_id) {
    throw new Error("legacy chat has no id");
  }
  const created_at = as_iso(raw.createdAt, now);
  const project_path = as_string(raw.projectPath);
  const media: LegacyMediaRef[] = [];
  const messages: Message[] = [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const message of as_array(raw.messages).map(as_record)) {
    const stored_id = as_string(message.id);
    const id = stored_id && !seen.has(stored_id) ? stored_id : randomUUID();
    seen.add(id);
    ids.push(id);
    const message_time = as_iso(message.createdAt, created_at);
    if (message.role === "user") {
      messages.push(legacy_user(message, id, message_time, media));
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }
    if (as_string(message.backgroundTaskId) && messages.at(-1)?.role !== "user") {
      messages.push({ id: randomUUID(), role: "user", text: "", attachments: [], origin: "background", created_at: message_time });
    }
    messages.push(legacy_assistant(message, id, message_time, step_context(project_path, media)));
  }
  const title = as_string(raw.title).trim();
  const chat: Chat = {
    id: chat_id_pattern.test(legacy_id) ? legacy_id : randomUUID(),
    title: title === "New chat" ? "" : title.slice(0, 200),
    project_path,
    workspace: legacy_workspace(legacy_root, project_path, as_string(raw.workspaceName)),
    pinned: raw.pinned === true,
    created_at,
    updated_at: as_iso(raw.updatedAt, created_at),
    message_count: messages.length,
    streaming: false,
    summary: legacy_summary(raw, ids),
    messages,
  };
  return { chat, media };
};
