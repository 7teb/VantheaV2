import fs from "node:fs/promises";
import path from "node:path";
import type { AssistantMessage, Message, UserMessage } from "../shared/chat.ts";
import type { TurnDiffChange } from "../shared/turn-diff.ts";
import { init_turn_diffs, turn_diffs } from "../electron/turn-diff/index.ts";
import { scratch } from "./git-kit.ts";

export const user = (id: string, origin: UserMessage["origin"] = "user"): UserMessage => ({ id, role: "user", text: "", attachments: [], origin, created_at: new Date().toISOString() });

export const assistant = (id: string): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "",
  mode: "auto",
  plan: false,
  created_at: new Date().toISOString(),
  ended_at: null,
  status: "done",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

export const chats = new Map<string, Message[]>();

export const on_disk = new Set<string>();

export const changes: TurnDiffChange[] = [];

export const service = { running: null as string | null, root: "" };

export const roots = new Map<string, string>();

export const start_service = async () => {
  service.root = path.join(await scratch("tds-store"), "turn-diffs");
  await init_turn_diffs({
    root: service.root,
    messages: async (chat_id) => chats.get(chat_id) ?? null,
    chat_root: async (chat_id) => {
      const root = roots.get(chat_id);
      if (!root) throw new Error(`chat ${chat_id} has no folder in the test`);
      return root;
    },
    running_turn: () => service.running,
    chat_known: async (chat_id) => chats.has(chat_id) || on_disk.has(chat_id),
  });
  turn_diffs.listen((change) => changes.push(change));
};

export const signal = new AbortController().signal;

export const open_turn = async (chat_id: string, message_id: string, root: string, origin: UserMessage["origin"] = "user") => {
  const messages = chats.get(chat_id) ?? [];
  chats.set(chat_id, messages);
  messages.push(user(`u_${message_id}`, origin), assistant(message_id));
  service.running = message_id;
  roots.set(chat_id, root);
  turn_diffs.begin(chat_id, message_id, root);
  await turn_diffs.ready(chat_id, message_id, signal);
};

export const close_turn = (chat_id: string, message_id: string) => {
  service.running = null;
  turn_diffs.end(chat_id, message_id);
};

export const agent_write = async (chat_id: string, file: string, body: string | Buffer | null) => {
  await turn_diffs.before_write(chat_id, file);
  if (body === null) await fs.rm(file);
  else {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }
};

export const chat_dir = (chat_id: string) => path.join(service.root, chat_id);

export const read_turns_file = async (chat_id: string) => JSON.parse(await fs.readFile(path.join(chat_dir(chat_id), "turns.json"), "utf8"));
