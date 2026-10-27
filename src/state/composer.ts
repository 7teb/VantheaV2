import type { CompactResult } from "../../shared/ipc/chats.ts";
import { attachment_limits } from "../../shared/ipc/media.ts";
import { api } from "../api/bridge.ts";
import { t } from "../i18n/index.ts";
import { chat_busy } from "./chat-busy.ts";
import { create_chat } from "./chat-create.ts";
import {
  acknowledge_steer,
  clear_after_compaction,
  dequeue,
  fail_steering,
  draft_key,
  draft_of,
  draft_sendable,
  empty_composer,
  enqueue,
  mark_after_compaction,
  move_draft,
  patch_draft,
  put_upload,
  queue_of,
  queued_to_draft,
  remove_chip,
  remove_queued,
  remove_upload,
  release_steers,
  restore_draft,
  set_error,
  set_flag,
  set_steering,
  take_draft,
  toggle_chip,
  upload_draft_key,
  type ComposerState,
  type DraftChip,
  type DraftUpload,
  type OutgoingMessage,
} from "./chat-drafts.ts";
import { last_assistant } from "./chat-view-reduce.ts";
import { chat_view_store, compact_chat_now, on_steer_taken, on_turn_end } from "./chat-view.ts";
import { create_store } from "./create-store.ts";
import { model_source } from "./model-source.ts";
import { settings_store } from "./settings.ts";
import { worktree_choice } from "./worktree.ts";

export const composer_store = create_store<ComposerState>(empty_composer);

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

export const set_sending = (key: string, sending: boolean) =>
  composer_store.update((state) => ({ ...state, sending: set_flag(state.sending, key, sending) }));

export const set_draft_text = (key: string, text: string) => composer_store.update((state) => patch_draft(state, key, { text }));

export const toggle_plan = (key: string) => composer_store.update((state) => patch_draft(state, key, { plan: !draft_of(state, key).plan }));

export const dismiss_error = (key: string) => composer_store.update((state) => set_error(state, key, ""));

export const set_composer_error = (key: string, error: string) => composer_store.update((state) => set_error(state, key, error));

export const toggle_draft_chip = (key: string, chip: DraftChip) => composer_store.update((state) => toggle_chip(state, key, chip));

export const remove_draft_chip = (key: string, chip: DraftChip) => composer_store.update((state) => remove_chip(state, key, chip));

export const carry_new_draft = (from: string, to: string) => {
  const current = composer_store.get();
  const target = draft_of(current, to);
  if (target.text !== "" || target.uploads.length > 0 || target.chips.length > 0) {
    return;
  }
  composer_store.set(move_draft(current, from, to));
};

const discard_ids = (ids: string[]) => {
  if (ids.length === 0) {
    return;
  }
  api.invoke("attachments:discard", ids).catch((error: unknown) => console.error(`[composer] attachments:discard failed for ${ids.join(", ")}`, error));
};

const revoke_previews = (uploads: DraftUpload[]) => {
  for (const upload of uploads) {
    if (upload.preview) {
      URL.revokeObjectURL(upload.preview);
    }
  }
};

export const discard_upload = (key: string, upload_key: string) => {
  const upload = draft_of(composer_store.get(), key).uploads.find((entry) => entry.key === upload_key);
  if (!upload) {
    return;
  }
  composer_store.update((state) => remove_upload(state, key, upload_key));
  revoke_previews([upload]);
  discard_ids(upload.attachment ? [upload.attachment.id] : []);
};

const upload_one = async (key: string, file: File) => {
  const image = file.type.startsWith("image/");
  const name = file.name || (image ? "image.png" : "file.txt");
  const limit = image ? attachment_limits.image_bytes : attachment_limits.file_bytes;
  if (file.size > limit) {
    composer_store.update((state) => set_error(state, key, t("composer.too_large", { name, limit: megabytes(limit) })));
    return;
  }
  const upload_key = crypto.randomUUID();
  const base: DraftUpload = { key: upload_key, name, size: file.size, image, status: "uploading", attachment: null, preview: image ? URL.createObjectURL(file) : null };
  composer_store.update((state) => put_upload(state, key, base));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const source = image ? await model_source(file) : null;
    const source_path = api.file_path(file);
    const attachment = await api.invoke("attachments:save", {
      name,
      mime: file.type || "text/plain",
      bytes,
      ...(source ? { model_source: source } : {}),
      ...(source_path ? { source_path } : {}),
    });
    const holder = upload_draft_key(composer_store.get(), upload_key);
    if (holder === null) {
      discard_ids([attachment.id]);
      return;
    }
    composer_store.update((state) => put_upload(state, holder, { ...base, image: attachment.kind === "image", status: "ready", attachment }));
  } catch (error) {
    console.error(`[composer] attachments:save failed for ${name} (${file.size} bytes)`, error);
    revoke_previews([base]);
    const holder = upload_draft_key(composer_store.get(), upload_key) ?? key;
    composer_store.update((state) => set_error(remove_upload(state, holder, upload_key), holder, t("composer.upload_failed", { name, error: error_text(error) })));
  }
};

export const attach_files = async (key: string, files: File[]) => {
  const room = attachment_limits.max_files - draft_of(composer_store.get(), key).uploads.length;
  if (files.length > room) {
    composer_store.update((state) => set_error(state, key, t("composer.max_files", { n: attachment_limits.max_files })));
  }
  await Promise.all(files.slice(0, Math.max(0, room)).map((file) => upload_one(key, file)));
};

const send_now = async (chat_id: string, message: OutgoingMessage) => {
  const settings = settings_store.get();
  if (!settings) {
    composer_store.update((state) => set_error(restore_draft(state, chat_id, message), chat_id, t("composer.settings_missing")));
    return;
  }
  set_sending(chat_id, true);
  try {
    await api.invoke("turn:send", {
      chat_id,
      text: message.text,
      attachment_ids: message.attachments.map((attachment) => attachment.id),
      model: settings.model,
      effort: settings.effort,
      mode: settings.mode,
      plan: message.plan,
      origin: "user",
    });
  } catch (error) {
    console.error(`[composer] turn:send failed for chat ${chat_id}`, error);
    composer_store.update((state) => set_error(restore_draft(state, chat_id, message), chat_id, error_text(error)));
  } finally {
    set_sending(chat_id, false);
  }
};

const dispatch = async (chat_id: string, message: OutgoingMessage) => {
  const current = composer_store.get();
  if (current.compacting[chat_id]) {
    composer_store.update((state) => enqueue(state, chat_id, { ...message, id: crypto.randomUUID(), steering: false, after_compaction: true }));
    return;
  }
  if (chat_busy(chat_id) || current.sending[chat_id]) {
    composer_store.update((state) => enqueue(state, chat_id, { ...message, id: crypto.randomUUID(), steering: false }));
    return;
  }
  await send_now(chat_id, message);
};

const take_message = (key: string): OutgoingMessage | null => {
  const current = composer_store.get();
  const draft = draft_of(current, key);
  if (!draft_sendable(draft)) {
    return null;
  }
  const taken = take_draft(current, key);
  revoke_previews(draft.uploads);
  composer_store.set(set_error(taken.state, key, ""));
  return taken.message;
};

export const submit = async (chat_id: string | null, project_path: string) => {
  const key = draft_key(chat_id, project_path);
  if (chat_id === null && composer_store.get().sending[key]) {
    return;
  }
  const message = take_message(key);
  if (!message) {
    return;
  }
  if (chat_id !== null) {
    await dispatch(chat_id, message);
    return;
  }
  const target = await create_chat(project_path, key, message, worktree_choice(key));
  if (target !== null) {
    await send_now(target, message);
  }
};

export const queue_draft = async (chat_id: string) => {
  const message = take_message(chat_id);
  if (message) {
    await dispatch(chat_id, message);
  }
};

export const send_plan_feedback = async (chat_id: string, text: string) => {
  composer_store.update((state) => set_error(state, chat_id, ""));
  await dispatch(chat_id, { text, attachments: [], plan: true });
};

export const send_queued = async (chat_id: string, id: string) => {
  const entry = queue_of(composer_store.get(), chat_id).find((item) => item.id === id);
  if (!entry || entry.steering || entry.after_compaction) {
    return;
  }
  if (composer_store.get().compacting[chat_id]) {
    composer_store.update((state) => mark_after_compaction(state, chat_id, id));
    return;
  }
  if (chat_busy(chat_id) || composer_store.get().sending[chat_id]) {
    return;
  }
  composer_store.update((state) => remove_queued(state, chat_id, id));
  await send_now(chat_id, entry);
};

export const steer_queued = async (chat_id: string, id: string) => {
  const entry = queue_of(composer_store.get(), chat_id).find((item) => item.id === id);
  if (!entry || entry.steering || entry.after_compaction) {
    return;
  }
  if (composer_store.get().compacting[chat_id]) {
    composer_store.update((state) => mark_after_compaction(state, chat_id, id));
    return;
  }
  const steer_id = crypto.randomUUID();
  const chat = chat_view_store.get().entries[chat_id]?.chat;
  const turn_id = chat ? last_assistant(chat)?.id : undefined;
  composer_store.update((state) => set_steering(state, chat_id, id, true, steer_id, turn_id));
  try {
    const accepted_turn = await api.invoke("turn:steer", chat_id, entry.text, entry.attachments.map((attachment) => attachment.id), steer_id);
    composer_store.update((state) => {
      const pending = queue_of(state, chat_id).find((item) => item.id === id && item.steer_id === steer_id);
      if (!pending?.steering) {
        return state;
      }
      return accepted_turn ? set_steering(state, chat_id, id, true, steer_id, accepted_turn) : fail_steering(state, chat_id, id);
    });
  } catch (error) {
    console.error(`[composer] turn:steer failed for chat ${chat_id}`, error);
    composer_store.update((state) => {
      const pending = queue_of(state, chat_id).find((item) => item.id === id && item.steer_id === steer_id);
      return pending ? set_error(fail_steering(state, chat_id, id), chat_id, error_text(error)) : state;
    });
  }
};

export const discard_queued = (chat_id: string, id: string) => {
  const entry = queue_of(composer_store.get(), chat_id).find((item) => item.id === id);
  composer_store.update((state) => remove_queued(state, chat_id, id));
  discard_ids(entry?.attachments.map((attachment) => attachment.id) ?? []);
};

export const edit_queued = (chat_id: string, id: string) => composer_store.update((state) => queued_to_draft(state, chat_id, id));

export const stop_turn = async (chat_id: string) => {
  const chat = chat_view_store.get().entries[chat_id]?.chat;
  const message_id = chat ? last_assistant(chat)?.id : undefined;
  try {
    await api.invoke("turn:stop", chat_id);
    composer_store.update((state) => release_steers(state, chat_id, message_id));
  } catch (error) {
    console.error(`[composer] turn:stop failed for chat ${chat_id}`, error);
    composer_store.update((state) => set_error(state, chat_id, error_text(error)));
  }
};

const send_next = (chat_id: string) => {
  const current = composer_store.get();
  if (chat_busy(chat_id) || current.sending[chat_id] || current.compacting[chat_id]) {
    return;
  }
  const { state, next } = dequeue(current, chat_id);
  if (!next) {
    return;
  }
  composer_store.set(state);
  void send_now(chat_id, next);
};

const release_after_compaction = async (chat_id: string, status: CompactResult["status"]) => {
  const first = queue_of(composer_store.get(), chat_id).find((entry) => entry.after_compaction);
  composer_store.update((state) => clear_after_compaction(state, chat_id));
  if (status === "busy") {
    return;
  }
  if (!first) {
    if (status === "done") {
      send_next(chat_id);
    }
    return;
  }
  composer_store.update((state) => remove_queued(state, chat_id, first.id));
  await send_now(chat_id, first);
};

export const compact_now = async (chat_id: string): Promise<CompactResult["status"]> => {
  composer_store.update((state) => ({ ...state, compacting: set_flag(state.compacting, chat_id, true) }));
  const status = await compact_chat_now(chat_id);
  composer_store.update((state) => ({ ...state, compacting: set_flag(state.compacting, chat_id, false) }));
  void release_after_compaction(chat_id, status);
  return status;
};

export const init_composer = (): (() => void) => {
  const stop_steers = on_steer_taken((chat_id, steer_id) => {
    composer_store.update((state) => acknowledge_steer(state, chat_id, steer_id));
  });
  const stop_ends = on_turn_end((chat_id, status, message_id) => {
    composer_store.update((state) => release_steers(state, chat_id, message_id));
    if (status === "done") {
      send_next(chat_id);
    }
  });
  return () => {
    stop_steers();
    stop_ends();
  };
};
