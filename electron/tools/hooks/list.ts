import { chat_hooks, chat_project } from "../../hooks/store.ts";
import { define_tool } from "../types.ts";
import { hooks_result, hooks_text } from "./common.ts";

export const list_hooks_tool = define_tool<Record<string, never>>({
  spec: {
    name: "list_hooks",
    description:
      "List the hooks that apply to this chat (the global ones and the ones of this chat's project) with their ids, event, matcher, shell, timeout, on/off state and exact command. Read-only, runs without approval. Call it before save_hook with an id or delete_hook.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main", "plan"],
  concurrent: true,
  parse: () => ({}),
  run: async (ctx) => {
    const hooks = chat_hooks(chat_project(ctx.chat_id));
    const text = hooks.length ? `${hooks.length} hooks apply to this chat (id event [matcher] (shell, timeout, on/off): command):\n\n${hooks_text(hooks)}` : "No hooks apply to this chat.";
    return hooks_result("done", "list", text, hooks);
  },
});
