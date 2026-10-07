import { attachment_limits } from "../../shared/ipc/media.ts";
import { api } from "../api/bridge.ts";
import { t } from "../i18n/index.ts";
import { chats_store } from "./chats.ts";
import {
  acknowledge_steer,
  dequeue,
  fail_steering,
  draft_key,
  draft_of,
  draft_sendable,
  empty_composer,
  enqueue,
  max_uploads,
  move_draft,
  patch_draft,
  put_upload,
  queue_of,
  remove_queued,
  remove_upload,
  release_steers,
  restore_draft,
  set_error,
  set_flag,
  set_steering,
  take_draft,
  type ComposerState,
  type OutgoingMessage,
} from "./chat-drafts.ts";
import { entry_streaming, last_assistant } from "./chat-view-reduce.ts";
import { chat_view_store, on_steer_taken, on_turn_end } from "./chat-view.ts";
import { create_store } from "./create-store.ts";
import { settings_store } from "./settings.ts";
import { open_chat } from "./ui.ts";

export const composer_store = create_store<ComposerState>(empty_composer);

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

const chat_busy = (chat_id: string): boolean => {
  const streaming = entry_streaming(chat_view_store.get().entries[chat_id]);
  if (streaming !== null) {
    return streaming;
  }
  return chats_store.get().list.find((chat) => chat.id === chat_id)?.streaming ?? false;
};

const set_sending = (key: string, sending: boolean) =>
  composer_store.update((state) => ({ ...state, sending: set_flag(state.sending, key, sending) }));

export const set_draft_text = (key: string, text: string) => composer_store.update((state) => patch_draft(state, key, { text }));

export const toggle_plan = (key: string) => composer_store.update((state) => patch_draft(state, key, { plan: !draft_of(state, key).plan }));

export const dismiss_error = (key: string) => composer_store.update((state) => set_error(state, key, ""));

export const discard_upload = (key: string, upload_key: string) => composer_store.update((state) => remove_upload(state, key, upload_key));

const upload_one = async (key: string, file: File) => {
  const upload_key = crypto.randomUUID();
  const image = file.type.startsWith("image/");
  const limit = image ? attachment_limits.image_bytes : attachment_limits.text_bytes;
  const base = { key: upload_key, name: file.name || (image ? "image.png" : "file.txt"), size: file.size, image, attachment: null };
  if (file.size > limit) {
    const error = t("composer.too_large", { name: base.name, limit: megabytes(limit) });
    composer_store.update((state) => put_upload(state, key, { ...base, status: "failed", error }));
    return;
  }
  composer_store.update((state) => put_upload(state, key, { ...base, status: "uploading", error: "" }));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const attachment = await api.invoke("attachments:save", { name: base.name, mime: file.type || "text/plain", bytes });
    composer_store.update((state) =>
      draft_of(state, key).uploads.some((entry) => entry.key === upload_key)
        ? put_upload(state, key, { ...base, status: "ready", attachment, error: "" })
        : state,
    );
  } catch (error) {
    console.error(`[composer] attachments:save failed for ${base.name} (${file.size} bytes)`, error);
    composer_store.update((state) => put_upload(state, key, { ...base, status: "failed", error: error_text(error) }));
  }
};

export const attach_files = async (key: string, files: File[]) => {
  const room = max_uploads - draft_of(composer_store.get(), key).uploads.length;
  if (files.length > room) {
    composer_store.update((state) => set_error(state, key, t("composer.max_files", { n: max_uploads })));
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
      attachments: message.attachments,
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

const create_chat = async (project_path: string, key: string, message: OutgoingMessage): Promise<string | null> => {
  set_sending(key, true);
  try {
    const meta = await api.invoke("chats:create", project_path);
    composer_store.update((state) => move_draft(state, key, meta.id));
    open_chat(meta.id, meta.project_path);
    return meta.id;
  } catch (error) {
    console.error(`[composer] chats:create failed for project ${project_path}`, error);
    composer_store.update((state) => set_error(restore_draft(state, key, message), key, error_text(error)));
    return null;
  } finally {
    set_sending(key, false);
  }
};

export const submit = async (chat_id: string | null, project_path: string) => {
  const key = draft_key(chat_id, project_path);
  const current = composer_store.get();
  if (!draft_sendable(draft_of(current, key)) || (chat_id === null && current.sending[key])) {
    return;
  }
  const taken = take_draft(current, key);
  composer_store.set(set_error(taken.state, key, ""));
  if (chat_id !== null && (chat_busy(chat_id) || current.sending[key])) {
    composer_store.update((state) => enqueue(state, chat_id, { ...taken.message, id: crypto.randomUUID(), steering: false }));
    return;
  }
  const target = chat_id ?? (await create_chat(project_path, key, taken.message));
  if (target !== null) {
    await send_now(target, taken.message);
  }
};

export const send_queued = async (chat_id: string, id: string) => {
  const entry = queue_of(composer_store.get(), chat_id).find((item) => item.id === id);
  if (!entry || entry.steering || chat_busy(chat_id) || composer_store.get().sending[chat_id]) {
    return;
  }
  composer_store.update((state) => remove_queued(state, chat_id, id));
  await send_now(chat_id, entry);
};

export const steer_queued = async (chat_id: string, id: string) => {
  const entry = queue_of(composer_store.get(), chat_id).find((item) => item.id === id);
  if (!entry || entry.steering) {
    return;
  }
  const steer_id = crypto.randomUUID();
  const chat = chat_view_store.get().entries[chat_id]?.chat;
  const turn_id = chat ? last_assistant(chat)?.id : undefined;
  composer_store.update((state) => set_steering(state, chat_id, id, true, steer_id, turn_id));
  try {
    const accepted_turn = await api.invoke("turn:steer", chat_id, entry.text, entry.attachments, steer_id);
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

export const discard_queued = (chat_id: string, id: string) => composer_store.update((state) => remove_queued(state, chat_id, id));

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
  if (chat_busy(chat_id) || composer_store.get().sending[chat_id]) {
    return;
  }
  const { state, next } = dequeue(composer_store.get(), chat_id);
  if (!next) {
    return;
  }
  composer_store.set(state);
  void send_now(chat_id, next);
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
