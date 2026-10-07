import type { ChatSearchHit } from "../../shared/chat.ts";
import { read_search_text, search_text } from "./files.ts";
import { bodies, sorted_metas } from "./state.ts";

const max_search_hits = 50;

const snippet_radius = 60;

const snippet_at = (text: string, needle: string): string | null => {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) {
    return null;
  }
  const start = Math.max(0, at - snippet_radius);
  const end = Math.min(text.length, at + needle.length + snippet_radius);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${core}${end < text.length ? "..." : ""}`;
};

const chat_text = async (chat_id: string): Promise<string> => {
  const body = bodies.get(chat_id);
  return body ? search_text(body.messages) : read_search_text(chat_id);
};

export const search_chats = async (query: string): Promise<ChatSearchHit[]> => {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const hits: ChatSearchHit[] = [];
  for (const meta of sorted_metas()) {
    if (hits.length >= max_search_hits) {
      break;
    }
    const snippet = snippet_at(meta.title, needle) ?? snippet_at(meta.project_path, needle) ?? snippet_at(await chat_text(meta.id), needle);
    if (snippet !== null) {
      hits.push({ chat_id: meta.id, title: meta.title, project_path: meta.project_path, snippet, updated_at: meta.updated_at });
    }
  }
  return hits;
};
