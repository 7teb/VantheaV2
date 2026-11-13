import { hook_fields } from "../../../shared/hooks.ts";
import { chat_project, remove_hook } from "../../hooks/store.ts";
import { require_string } from "../browser/common.ts";
import { define_tool } from "../types.ts";
import { approve_change, card_scope, chat_hook, hook_line, hooks_result, unknown_hook } from "./common.ts";

export const delete_hook_tool = define_tool<{ id: string }>({
  spec: {
    name: "delete_hook",
    description: "Delete one hook by its id from list_hooks.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Id of the hook, from list_hooks." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: (raw) => ({ id: require_string(raw, "id").trim() }),
  run: async (ctx, args) => {
    const existing = chat_hook(chat_project(ctx.chat_id), args.id);
    if (!existing) {
      return unknown_hook(args.id);
    }
    const refused = await approve_change(ctx, { kind: "hook", action: "delete", scope: card_scope(existing.scope), hook: hook_fields(existing), previous: null });
    if (refused) {
      return refused;
    }
    await remove_hook(existing.id);
    return hooks_result("done", "delete", `Deleted hook${hook_line(existing)}.`, [existing]);
  },
});
