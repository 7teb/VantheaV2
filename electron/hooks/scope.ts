import type { Hook, HookScope, HooksConfig, ScopedHook } from "../../shared/hooks.ts";
import { path_key } from "../storage/paths.ts";

const project_key = (config: HooksConfig, project_path: string): string | null =>
  Object.keys(config.projects).find((key) => path_key(key) === path_key(project_path)) ?? null;

export const scope_hooks = (config: HooksConfig, scope: HookScope): Hook[] => {
  if (scope.kind === "global") {
    return config.global;
  }
  const key = project_key(config, scope.path);
  return key === null ? [] : (config.projects[key] ?? []);
};

export const with_scope_hooks = (config: HooksConfig, scope: HookScope, hooks: Hook[]): HooksConfig => {
  if (scope.kind === "global") {
    return { ...config, global: hooks };
  }
  const key = project_key(config, scope.path) ?? scope.path;
  const projects = Object.fromEntries(Object.entries(config.projects).filter(([entry]) => entry !== key));
  return { ...config, projects: hooks.length ? { ...projects, [key]: hooks } : projects };
};

export const chat_scopes = (project_path: string): HookScope[] => [{ kind: "global" }, ...(project_path ? [{ kind: "project" as const, path: project_path }] : [])];

export const scoped_hooks = (config: HooksConfig, scopes: HookScope[]): ScopedHook[] =>
  scopes.flatMap((scope) => scope_hooks(config, scope).map((hook) => ({ ...hook, scope: scope.kind === "global" ? scope : { kind: "project" as const, path: project_key(config, scope.path) ?? scope.path } })));

export const all_scopes = (config: HooksConfig): HookScope[] => [{ kind: "global" }, ...Object.keys(config.projects).map((path) => ({ kind: "project" as const, path }))];

export const locate_hook = (config: HooksConfig, id: string): ScopedHook | null => scoped_hooks(config, all_scopes(config)).find((hook) => hook.id === id) ?? null;

export const rekey_project_hooks = (config: HooksConfig, from: string, to: string): HooksConfig => {
  const moved = scope_hooks(config, { kind: "project", path: from });
  if (!moved.length || path_key(from) === path_key(to)) {
    return config;
  }
  const without = with_scope_hooks(config, { kind: "project", path: from }, []);
  return with_scope_hooks(without, { kind: "project", path: to }, [...scope_hooks(without, { kind: "project", path: to }), ...moved]);
};

export const drop_project_hooks = (config: HooksConfig, project_path: string): HooksConfig => with_scope_hooks(config, { kind: "project", path: project_path }, []);
