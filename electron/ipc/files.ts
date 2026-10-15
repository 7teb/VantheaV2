import { shell, type WebContents } from "electron";
import type { FilesScope } from "../../shared/ipc/files.ts";
import { main_window } from "../app/window.ts";
import { files_root, parse_scope, require_root } from "../project/files-root.ts";
import { invalidate_index } from "../project/index.ts";
import { find_files, list_dir, tree_path } from "../project/listing.ts";
import { resolve_inside } from "../project/scope.ts";
import { read_for_view } from "../project/view-read.ts";
import { watch_tree, type TreeWatcher } from "../project/watch.ts";
import { require_string } from "../storage/coerce.ts";
import { emit, handle } from "./handle.ts";

let watching: { root: string; chat_id: string | null; watcher: TreeWatcher } | null = null;
let generation = 0;
let hooked: WebContents | null = null;

export const stop_files_watch = () => {
  generation += 1;
  watching?.watcher.close();
  watching = null;
};

export const stop_chat_files_watch = (chat_id: string) => {
  if (watching?.chat_id === chat_id) {
    stop_files_watch();
  }
};

const hook_renderer = () => {
  const contents = main_window()?.webContents;
  if (!contents || contents === hooked) {
    return;
  }
  hooked = contents;
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      stop_files_watch();
    }
  });
  contents.on("destroyed", stop_files_watch);
};

const start_files_watch = async (scope: FilesScope) => {
  const ticket = ++generation;
  const root = await files_root(scope);
  if (ticket !== generation) {
    return;
  }
  if (watching && watching.root === root?.path) {
    watching.chat_id = scope.chat_id;
    return;
  }
  watching?.watcher.close();
  watching = null;
  if (!root) {
    return;
  }
  hook_renderer();
  const watcher = watch_tree(root.path, (change) => {
    invalidate_index(root.path);
    emit("files:changed", { root: root.path, ...change });
  });
  watching = { root: root.path, chat_id: scope.chat_id, watcher };
};

const entry_path = (value: unknown) => require_string(value, "file path", 4000);

export const register_files_ipc = () => {
  handle("files:root", (scope) => files_root(parse_scope(scope)));
  handle("files:list", async (scope, relative) => list_dir(await require_root(parse_scope(scope)), entry_path(relative)));
  handle("files:read", async (scope, relative) => read_for_view(await require_root(parse_scope(scope)), entry_path(relative)));
  handle("files:find", async (scope, query) => find_files(await require_root(parse_scope(scope)), require_string(query, "file filter", 500)));
  handle("files:reveal", async (scope, relative) => {
    const scoped = await resolve_inside(await require_root(parse_scope(scope)), tree_path(entry_path(relative)) || ".");
    shell.showItemInFolder(scoped.target);
  });
  handle("files:watch", (scope) => start_files_watch(parse_scope(scope)));
  handle("files:unwatch", () => stop_files_watch());
};
