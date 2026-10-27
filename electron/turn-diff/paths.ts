import path from "node:path";

export type ChatPaths = { dir: string; index: string; index_lock: string; objects: string; turns: string; summaries: string; recorded: string };

export const chat_paths = (root: string, chat_id: string): ChatPaths => {
  const dir = path.join(root, chat_id);
  return {
    dir,
    index: path.join(dir, "index"),
    index_lock: path.join(dir, "index.lock"),
    objects: path.join(dir, "objects"),
    turns: path.join(dir, "turns.json"),
    summaries: path.join(dir, "summaries.json"),
    recorded: path.join(dir, "recorded"),
  };
};

export const recorded_dir = (paths: ChatPaths, message_id: string): string => path.join(paths.recorded, message_id);

export const slot_file = (paths: ChatPaths, message_id: string, slot: number, side: "before" | "after"): string =>
  path.join(recorded_dir(paths, message_id), `${slot}.${side}`);
