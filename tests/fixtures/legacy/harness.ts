import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import type { AssistantMessage, Attachment, ChatMeta, UserMessage } from "../../../shared/chat.ts";
import type { QuestionStates } from "../../../shared/questions.ts";
import { init_chats } from "../../../electron/chats/store.ts";
import { init_media } from "../../../electron/media/files.ts";

export type ChatsEnv = { root: string; changed: ChatMeta[]; removed: string[]; questions: { chat_id: string; questions: QuestionStates }[] };

export const chat_dirs_in = (root: string) => ({
  index_file: path.join(root, "v2", "chats", "index.json"),
  data_dir: path.join(root, "v2", "chats", "data"),
  search_dir: path.join(root, "v2", "chats", "search"),
});

export const media_dirs_in = (root: string) => ({
  attachments: path.join(root, "v2", "media", "attachments"),
  images: path.join(root, "v2", "media", "images"),
});

export const make_root = (prefix: string) => fs.mkdtemp(path.join(os.tmpdir(), prefix));

export const boot_chats = async (root: string, legacy_root = path.join(root, "no-legacy")): Promise<ChatsEnv> => {
  const env: ChatsEnv = { root, changed: [], removed: [], questions: [] };
  const media = media_dirs_in(root);
  await fs.mkdir(media.attachments, { recursive: true });
  await fs.mkdir(media.images, { recursive: true });
  init_media(media);
  await init_chats({
    dirs: chat_dirs_in(root),
    legacy_root,
    events: {
      changed: (meta) => env.changed.push(meta),
      removed: (chat_id) => env.removed.push(chat_id),
      appended: () => {},
      truncated: () => {},
      questions: (chat_id, questions) => env.questions.push({ chat_id, questions }),
    },
  });
  return env;
};

export const read_disk_chat = async (root: string, chat_id: string) =>
  JSON.parse(brotliDecompressSync(await fs.readFile(path.join(chat_dirs_in(root).data_dir, `${chat_id}.vxc`))).toString("utf8"));

export const user_message = (id: string, text: string, attachments: Attachment[] = []): UserMessage => ({
  id,
  role: "user",
  text,
  attachments,
  origin: "user",
  created_at: "2026-10-06T10:00:00.000Z",
});

export const assistant_message = (id: string, text: string, status: AssistantMessage["status"] = "done"): AssistantMessage => ({
  id,
  role: "assistant",
  model: "deepseek/deepseek-v4-flash",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-06T10:00:01.000Z",
  ended_at: status === "streaming" ? null : "2026-10-06T10:00:05.000Z",
  status,
  steps: text ? [{ id: "text:1", round: 0, kind: "text", text }] : [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: text ? 1 : 0,
});

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
