import { resolve_inside, to_posix, type ScopedPath } from "../../project/scope.ts";
import { scratch_path } from "../../scratchpad/index.ts";

export type FileScope = { chat_id: string; project_root: string };

export type ToolRoot = { root: string; relative: string; scratch: boolean };

export const tool_root = async (scope: FileScope, requested: string): Promise<ToolRoot> => {
  const scratch = await scratch_path(scope.chat_id, requested);
  if (!scratch) {
    return { root: scope.project_root, relative: requested, scratch: false };
  }

  return { ...scratch, scratch: true };
};

export const shown_path = <T extends ScopedPath>(scoped: T, root: ToolRoot): T => {
  if (!root.scratch) {
    return scoped;
  }

  return { ...scoped, relative: to_posix(scoped.target) };
};

export const resolve_tool_path = async (scope: FileScope, requested: string): Promise<ScopedPath> => {
  const root = await tool_root(scope, requested);
  return shown_path(await resolve_inside(root.root, root.relative), root);
};
