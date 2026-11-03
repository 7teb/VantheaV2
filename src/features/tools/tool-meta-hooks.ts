import type { MessageKey } from "../../i18n/translate.ts";
import { hook_action } from "./hook-preview.ts";
import { entry, fixed } from "./tool-meta-entry.ts";
import type { Label, ToolMeta } from "./tool-meta-types.ts";

type Phase = "active" | "done" | "attempt";

const change_label = (phase: Phase): Label => (t, step) => {
  const action = hook_action(step);
  return t(`hooks.label_${action === "list" ? "create" : action}_${phase}`);
};

export const hook_metas: Record<string, ToolMeta> = {
  list_hooks: entry("hook", "other", fixed("hooks.label_list_active"), fixed("hooks.label_list_done")),
  save_hook: entry("hook", "hooks", change_label("active"), change_label("done"), change_label("attempt")),
  delete_hook: entry("hook", "hooks", fixed("hooks.label_delete_active"), fixed("hooks.label_delete_done"), fixed("hooks.label_delete_attempt")),
};

export const hook_target_key = (name: string): MessageKey | null => {
  if (name === "list_hooks") {
    return "hooks.list_target";
  }
  return name === "save_hook" || name === "delete_hook" ? "hooks.denied_target" : null;
};
