import { get_chat, update_meta } from "../chats/store.ts";
import type { SideMessage, SideModelCall } from "../tools/types.ts";

const title_system =
  "You name chat threads. You are given the first message a user sent in a new chat. Reply with a SHORT title of two to four words saying what the chat is about, like a folder name. Write it in the same language the user wrote in. Capitalize only the first word unless a word is a proper noun. Output ONLY the title: no quotes, no trailing period, no prefix such as 'Title:', no explanation. If the message is empty or meaningless, output 'New chat'.";

const title_timeout_ms = 25000;

const max_input_chars = 4000;

export const clean_title = (raw: string): string => {
  const line = String(raw ?? "")
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) {
    return "";
  }
  return line
    .replace(/^(?:title|chat\s*name|name)\s*[:-]\s*/i, "")
    .replace(/^[\s"'*#]+/, "")
    .replace(/[\s"'*.!?,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
};

export const generate_title = async (text: string, side_model: SideModelCall): Promise<string> => {
  const messages: SideMessage[] = [
    { role: "system", content: title_system },
    { role: "user", content: String(text ?? "").slice(0, max_input_chars) },
  ];
  const signal = AbortSignal.timeout(title_timeout_ms);
  return clean_title(await side_model("title", messages, 8000, signal));
};

const run_title = async (chat_id: string, text: string) => {
  const chat = await get_chat(chat_id);
  if (!chat || chat.title.trim()) {
    return;
  }
  const { side_model } = await import("./model.ts");
  const title = await generate_title(text, side_model);
  const current = await get_chat(chat_id);
  if (title && current && !current.title.trim()) {
    await update_meta(chat_id, { title });
  }
};

export const start_title = (chat_id: string, text: string): void => {
  void run_title(chat_id, text).catch((error: unknown) => {
    console.error(`[side] generating a title for chat ${chat_id} failed:`, error);
  });
};
