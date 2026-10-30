import { chat_meta } from "../chats/store.ts";
import { chat_root } from "../chats/workspace.ts";
import type { PromptSection } from "../prompts/sections.ts";
import { list_saved } from "./saved.ts";
import { user_saved_dir } from "./store.ts";

export const saved_workflows_section = async (chat_id: string, tool_names: Set<string>): Promise<PromptSection | null> => {
  const meta = tool_names.has("run_workflow") ? chat_meta(chat_id) : null;
  if (!meta) {
    return null;
  }
  try {
    const saved = await list_saved(await chat_root(meta), user_saved_dir());
    if (!saved.length) {
      return null;
    }
    const lines = saved.map((entry) => `- ${entry.name} (${entry.scope} workflow): ${entry.description}${entry.when_to_use ? ` Use it when ${entry.when_to_use}` : ""}`);
    return { title: "saved_workflows", body: ["Saved workflows of this project and of the user. Run one with run_workflow and name set to its name, with args when it expects them:", ...lines].join("\n") };
  } catch (error) {
    console.error(`[workflows] listing the saved workflows for chat ${chat_id} failed:`, error);
    return null;
  }
};
