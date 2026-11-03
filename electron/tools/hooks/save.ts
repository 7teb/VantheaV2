import { changed_fields, hook_events, hook_fields, max_hook_timeout_s, type HookAction, type HookFields, type HookScope, type ScopedHook } from "../../../shared/hooks.ts";
import { shell_kinds } from "../../../shared/shell.ts";
import { chat_project, save_hook } from "../../hooks/store.ts";
import { parse_hook_fields } from "../../hooks/validate.ts";
import { find_project } from "../../settings/store.ts";
import { error_text } from "../../storage/coerce.ts";
import { define_tool, ToolArgumentError, type ToolContext, type ToolResult } from "../types.ts";
import { approval_rule, approve_change, card_scope, chat_hook, failed, hook_line, hook_reference, hooks_result, unknown_hook } from "./common.ts";

type ScopeKind = HookScope["kind"];

type SaveArgs = { id: string | null; scope: ScopeKind | null; given: Partial<Record<keyof HookFields, unknown>> };

const field_keys: readonly (keyof HookFields)[] = ["event", "matcher", "shell", "command", "timeout_s", "enabled"];

const required_on_create: readonly (keyof HookFields)[] = ["event", "shell", "command"];

const parse_save = (raw: Record<string, unknown>): SaveArgs => {
  const { id, scope } = raw;
  if (id !== undefined && typeof id !== "string") {
    throw new ToolArgumentError("id must be a string");
  }
  if (scope !== undefined && scope !== "global" && scope !== "project") {
    throw new ToolArgumentError('scope must be "global" or "project"');
  }
  const given = Object.fromEntries(field_keys.flatMap((key) => (raw[key] === undefined ? [] : [[key, raw[key]]])));
  return { id: id?.trim() || null, scope: scope ?? null, given };
};

const checked_fields = (raw: Record<string, unknown>): HookFields | string => {
  try {
    return parse_hook_fields(raw);
  } catch (error) {
    return `The hook is not valid: ${error_text(error)}. Nothing was changed.`;
  }
};

const approve_and_save = async (ctx: ToolContext, action: HookAction, scope: HookScope, fields: HookFields, existing: ScopedHook | null): Promise<ToolResult> => {
  const previous = existing && action === "change" ? hook_fields(existing) : null;
  const refused = await approve_change(ctx, { kind: "hook", action, scope: card_scope(scope), hook: fields, previous });
  if (refused) {
    return refused;
  }
  const saved = await save_hook(scope, fields, existing?.id ?? null);
  return hooks_result("done", action, `Saved hook${hook_line(saved.hook)}. It runs from the next matching event on.`, [saved.hook], previous);
};

const create = async (ctx: ToolContext, args: SaveArgs, project_path: string): Promise<ToolResult> => {
  if (!args.scope) {
    return failed('scope is required when creating a hook: "global" for all projects or "project" for this chat\'s project. Nothing was changed.');
  }
  const missing = required_on_create.filter((key) => args.given[key] === undefined);
  if (missing.length) {
    return failed(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required when creating a hook. Nothing was changed.`);
  }
  if (args.scope === "project" && !project_path) {
    return failed("This chat has no project; use scope global.");
  }
  const fields = checked_fields(args.given);
  if (typeof fields === "string") {
    return failed(fields);
  }
  const scope: HookScope = args.scope === "global" ? { kind: "global" } : { kind: "project", path: find_project(project_path)?.path ?? project_path };
  return approve_and_save(ctx, "create", scope, fields, null);
};

const change = async (ctx: ToolContext, id: string, args: SaveArgs, project_path: string): Promise<ToolResult> => {
  const existing = chat_hook(project_path, id);
  if (!existing) {
    return unknown_hook(id);
  }
  if (args.scope && args.scope !== existing.scope.kind) {
    return failed("The scope of an existing hook does not change. Delete it with delete_hook and create a new one in the other scope. Nothing was changed.");
  }
  const fields = checked_fields({ ...hook_fields(existing), ...args.given });
  if (typeof fields === "string") {
    return failed(fields);
  }
  const changed = changed_fields(fields, existing);
  if (!changed.length) {
    return hooks_result("done", "change", `Hook ${hook_line(existing)} already has these values. Nothing was changed.`, [existing]);
  }
  const toggled = changed.length === 1 && changed[0] === "enabled";
  return approve_and_save(ctx, toggled ? (fields.enabled ? "enable" : "disable") : "change", existing.scope, fields, existing);
};

export const save_hook_tool = define_tool<SaveArgs>({
  spec: {
    name: "save_hook",
    description: `Create or change a hook. Without id it creates one (scope, event, shell and command required); with id it changes only the fields you pass, and passing only enabled turns the hook on or off. ${approval_rule} ${hook_reference}`,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id of the hook to change, from list_hooks. Leave it out to create a hook." },
        scope: { type: "string", enum: ["global", "project"], description: "global runs in every project, project only in this chat's project. Required on create; an existing hook keeps its scope." },
        event: { type: "string", enum: [...hook_events] },
        matcher: { type: "string", description: "Tool name, agent type or error kind the hook applies to. Empty or * for all." },
        shell: { type: "string", enum: [...shell_kinds], description: "powershell or bash (Git Bash)." },
        command: { type: "string", description: "The exact command. It reads the event JSON from stdin." },
        timeout_s: { type: "integer", description: `Seconds before the hook is stopped, 1 to ${max_hook_timeout_s}. Default 60.` },
        enabled: { type: "boolean", description: "Default true." },
      },
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_save,
  run: async (ctx, args) => {
    const project_path = chat_project(ctx.chat_id);
    return args.id === null ? create(ctx, args, project_path) : change(ctx, args.id, args, project_path);
  },
});
