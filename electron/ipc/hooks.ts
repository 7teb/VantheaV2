import { remove_hook, save_hook, set_hook_enabled } from "../hooks/store.ts";
import { parse_hook_fields, parse_hook_id, parse_hook_scope } from "../hooks/validate.ts";
import { find_project } from "../settings/store.ts";
import { handle } from "./handle.ts";

const project_path_of = (path: string): string | null => find_project(path)?.path ?? null;

export const register_hooks_ipc = () => {
  handle("hooks:save", async (scope, fields, id) => {
    const parsed_scope = parse_hook_scope(scope, project_path_of);
    const parsed_fields = parse_hook_fields(fields);
    return (await save_hook(parsed_scope, parsed_fields, id === null ? null : parse_hook_id(id))).view;
  });
  handle("hooks:remove", (id) => remove_hook(parse_hook_id(id)));
  handle("hooks:set_enabled", (id, enabled) => {
    if (typeof enabled !== "boolean") {
      throw new Error("enabled must be a boolean");
    }
    return set_hook_enabled(parse_hook_id(id), enabled);
  });
};
