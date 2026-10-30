import { shell, type WebContents } from "electron";
import type { FilesScope } from "../../shared/ipc/files.ts";
import { main_window } from "../app/window.ts";
import { git_service } from "../git/index.ts";
import { files_root, parse_scope, require_root } from "../project/files-root.ts";
import { invalidate_index } from "../project/index.ts";
import { find_files, list_dir, tree_path } from "../project/listing.ts";
import { resolve_inside } from "../project/scope.ts";
import { read_for_view } from "../project/view-read.ts";
import { watch_tree, type TreeWatcher } from "../project/watch.ts";
import { require_string } from "../storage/coerce.ts";
import { client_connected, on_client_gone, on_client_presence, window_client, type ClientId } from "./clients.ts";
import { emit, handle, handle_client } from "./handle.ts";

export type FilesClaim = { scope: FilesScope; at: number };

let watching: { root: string; chat_id: string | null; watcher: TreeWatcher } | null = null;
let generation = 0;
let hooked: WebContents | null = null;
const claims = new Map<ClientId, FilesClaim>();
let claim_clock = 0;
let applied: FilesClaim | null = null;

export const newest_claim = (entries: Iterable<[ClientId, FilesClaim]>, connected: (client: ClientId) => boolean): FilesClaim | null => {
  let newest: FilesClaim | null = null;
  for (const [client, claim] of entries) {
    if (connected(client) && (!newest || claim.at > newest.at)) {
      newest = claim;
    }
  }
  return newest;
};

export const stop_files_watch = () => {
  generation += 1;
  applied = null;
  watching?.watcher.close();
  watching = null;
  git_service.stop();
};

const start_files_watch = async (scope: FilesScope) => {
  const ticket = ++generation;
  const root = await files_root(scope);
  if (ticket !== generation) {
    return;
  }
  if (watching && root && !root.worktree?.missing && watching.root === root.path) {
    watching.chat_id = scope.chat_id;
    git_service.bind(root);
    return;
  }
  watching?.watcher.close();
  watching = null;
  if (!root || root.worktree?.missing) {
    git_service.stop();
    return;
  }
  hook_renderer();
  const tap = git_service.bind(root);
  const watcher = watch_tree(
    root.path,
    (change) => {
      invalidate_index(root.path);
      emit("files:changed", { root: root.path, ...change });
    },
    undefined,
    tap,
  );
  watching = { root: root.path, chat_id: scope.chat_id, watcher };
};

const apply_claims = async () => {
  const claim = newest_claim(claims, client_connected);
  if (claim === applied) {
    return;
  }
  if (!claim) {
    stop_files_watch();
    return;
  }
  applied = claim;
  await start_files_watch(claim.scope);
};

const reapply = (reason: string) => {
  apply_claims().catch((error) => console.error(`[files] switching the watched folder after ${reason} failed:`, error));
};

const drop_claim = (client: ClientId, reason: string) => {
  if (claims.delete(client)) {
    reapply(reason);
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
      drop_claim(window_client, "a reload of the main window");
    }
  });
  contents.on("destroyed", () => drop_claim(window_client, "the main window closed"));
};

export const stop_chat_files_watch = (chat_id: string) => {
  let dropped = false;
  for (const [client, claim] of [...claims]) {
    if (claim.scope.chat_id === chat_id) {
      claims.delete(client);
      dropped = true;
    }
  }
  if (dropped) {
    reapply(`chat ${chat_id} was removed`);
  }
};

const watch_files = (client: ClientId, scope: FilesScope) => {
  claim_clock += 1;
  claims.set(client, { scope, at: claim_clock });
  return apply_claims();
};

on_client_presence((client, connected) => reapply(`${client} ${connected ? "connected" : "disconnected"}`));

on_client_gone((client) => drop_claim(client, `${client} left`));

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
  handle_client("files:watch", (client, scope) => watch_files(client, parse_scope(scope)));
  handle_client("files:unwatch", (client) => {
    claims.delete(client);
    return apply_claims();
  });
};
