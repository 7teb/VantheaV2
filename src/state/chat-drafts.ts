import type { Attachment } from "../../shared/chat.ts";

export type DraftUpload = {
  key: string;
  name: string;
  size: number;
  image: boolean;
  status: "uploading" | "ready" | "failed";
  attachment: Attachment | null;
  error: string;
};

export type Draft = { text: string; uploads: DraftUpload[]; plan: boolean };

export type OutgoingMessage = { text: string; attachments: Attachment[]; plan: boolean };

export type QueuedMessage = OutgoingMessage & { id: string; steering: boolean; steer_id?: string; steer_turn_id?: string; steer_failed?: boolean };

export type ComposerState = {
  drafts: Record<string, Draft>;
  queues: Record<string, QueuedMessage[]>;
  sending: Record<string, boolean>;
  errors: Record<string, string>;
};

export const max_uploads = 10;

export const empty_draft: Draft = { text: "", uploads: [], plan: false };

export const empty_composer: ComposerState = { drafts: {}, queues: {}, sending: {}, errors: {} };

export const draft_key = (chat_id: string | null, project_path: string) => chat_id ?? `new:${project_path}`;

export const draft_of = (state: ComposerState, key: string): Draft => state.drafts[key] ?? empty_draft;

const no_queue: QueuedMessage[] = [];

export const queue_of = (state: ComposerState, chat_id: string): QueuedMessage[] => state.queues[chat_id] ?? no_queue;

export const patch_draft = (state: ComposerState, key: string, patch: Partial<Draft>): ComposerState => ({
  ...state,
  drafts: { ...state.drafts, [key]: { ...draft_of(state, key), ...patch } },
});

export const put_upload = (state: ComposerState, key: string, upload: DraftUpload): ComposerState => {
  const uploads = draft_of(state, key).uploads;
  const exists = uploads.some((entry) => entry.key === upload.key);
  return patch_draft(state, key, { uploads: exists ? uploads.map((entry) => (entry.key === upload.key ? upload : entry)) : [...uploads, upload] });
};

export const remove_upload = (state: ComposerState, key: string, upload_key: string): ComposerState =>
  patch_draft(state, key, { uploads: draft_of(state, key).uploads.filter((entry) => entry.key !== upload_key) });

export const ready_attachments = (draft: Draft): Attachment[] =>
  draft.uploads.flatMap((upload) => (upload.status === "ready" && upload.attachment ? [upload.attachment] : []));

export const draft_sendable = (draft: Draft): boolean =>
  !draft.uploads.some((upload) => upload.status === "uploading") && (draft.text.trim().length > 0 || ready_attachments(draft).length > 0);

export const take_draft = (state: ComposerState, key: string): { state: ComposerState; message: OutgoingMessage } => {
  const draft = draft_of(state, key);
  const message = { text: draft.text.trim(), attachments: ready_attachments(draft), plan: draft.plan };
  return { state: patch_draft(state, key, { text: "", uploads: [] }), message };
};

export const restore_draft = (state: ComposerState, key: string, message: OutgoingMessage): ComposerState => {
  const draft = draft_of(state, key);
  const restored: DraftUpload[] = message.attachments.map((attachment) => ({
    key: attachment.id,
    name: attachment.name,
    size: attachment.size,
    image: attachment.kind === "image",
    status: "ready",
    attachment,
    error: "",
  }));
  const text = draft.text.trim() ? `${message.text}\n${draft.text}` : message.text;
  return patch_draft(state, key, { text, uploads: [...restored, ...draft.uploads] });
};

export const move_draft = (state: ComposerState, from: string, to: string): ComposerState => {
  if (from === to || !state.drafts[from]) {
    return state;
  }
  const drafts = { ...state.drafts, [to]: state.drafts[from] };
  delete drafts[from];
  return { ...state, drafts };
};

export const enqueue = (state: ComposerState, chat_id: string, entry: QueuedMessage): ComposerState => ({
  ...state,
  queues: { ...state.queues, [chat_id]: [...queue_of(state, chat_id), entry] },
});

const set_queue = (state: ComposerState, chat_id: string, queue: QueuedMessage[]): ComposerState => {
  const queues = { ...state.queues, [chat_id]: queue };
  if (queue.length === 0) {
    delete queues[chat_id];
  }
  return { ...state, queues };
};

export const dequeue = (state: ComposerState, chat_id: string): { state: ComposerState; next: QueuedMessage | null } => {
  const queue = queue_of(state, chat_id);
  const index = queue.findIndex((entry) => !entry.steering && !entry.steer_failed);
  if (index === -1) {
    return { state, next: null };
  }
  return { state: set_queue(state, chat_id, [...queue.slice(0, index), ...queue.slice(index + 1)]), next: queue[index] };
};

export const remove_queued = (state: ComposerState, chat_id: string, id: string): ComposerState =>
  set_queue(
    state,
    chat_id,
    queue_of(state, chat_id).filter((entry) => entry.id !== id),
  );

export const set_steering = (state: ComposerState, chat_id: string, id: string, steering: boolean, steer_id?: string, steer_turn_id?: string): ComposerState =>
  set_queue(
    state,
    chat_id,
    queue_of(state, chat_id).map((entry) => entry.id === id
      ? { ...entry, steering, steer_failed: false, steer_id: steer_id ?? entry.steer_id, steer_turn_id: steer_turn_id ?? entry.steer_turn_id }
      : entry),
  );

export const acknowledge_steer = (state: ComposerState, chat_id: string, steer_id: string): ComposerState => {
  const entry = queue_of(state, chat_id).find((item) => item.steer_id === steer_id);
  return entry ? remove_queued(state, chat_id, entry.id) : state;
};

export const fail_steering = (state: ComposerState, chat_id: string, id: string): ComposerState =>
  set_queue(state, chat_id, queue_of(state, chat_id).map((entry) => entry.id === id
    ? { ...entry, steering: false, steer_failed: true }
    : entry));

export const release_steers = (state: ComposerState, chat_id: string, message_id?: string): ComposerState => {
  const queue = queue_of(state, chat_id);
  const applies = (entry: QueuedMessage) => entry.steering && (!message_id || !entry.steer_turn_id || entry.steer_turn_id === message_id);
  if (!queue.some(applies)) {
    return state;
  }
  return set_queue(state, chat_id, queue.map((entry) => applies(entry)
    ? { ...entry, steering: false, steer_failed: true }
    : entry));
};

export const set_flag = (record: Record<string, boolean>, key: string, value: boolean): Record<string, boolean> => {
  const next = { ...record };
  if (value) {
    next[key] = true;
  } else {
    delete next[key];
  }
  return next;
};

export const set_error = (state: ComposerState, key: string, error: string): ComposerState => {
  const errors = { ...state.errors };
  if (error) {
    errors[key] = error;
  } else {
    delete errors[key];
  }
  return { ...state, errors };
};
