import type { BrowserWindow } from "electron";
import type { CommitDetail, GitFileDiff, GitView, HistoryPage, HistoryRequest, LineCount } from "../../shared/git-view.ts";
import type { FilesRoot } from "../../shared/ipc/files.ts";
import { main_window } from "../app/window.ts";
import type { TreeTap } from "../project/watch.ts";
import { path_key } from "../storage/paths.ts";
import { create_repo_busy, type RepoBusy, type WorkSources } from "./busy.ts";
import { create_commit_reader, type CommitReader } from "./commit.ts";
import { read_file_diff, read_line_counts } from "./diff.ts";
import { create_fetcher, type Fetcher, type GitWindow, type RemoteHead } from "./fetch.ts";
import { create_history, type GitHistory } from "./history.ts";
import { git_tool } from "./locate.ts";
import { default_readers } from "./readers.ts";
import type { GitRef } from "./refs.ts";
import { create_git_session, type GitSession } from "./session.ts";

export type GitEvent =
  | { kind: "view"; root: string; view: GitView; refs: GitRef[] }
  | { kind: "rebind"; root: string }
  | { kind: "refresh"; root: string }
  | { kind: "release"; root: string };

type GitListener = (event: GitEvent) => void;

type BoundGit = { session: GitSession; history: GitHistory; commits: CommitReader };

const listeners = new Set<GitListener>();

let bound: BoundGit | null = null;

let work: { busy: RepoBusy; fetcher: Fetcher } | null = null;

const on_window = (attach: (window: BrowserWindow) => void, detach: (window: BrowserWindow) => void) => {
  const window = main_window();
  if (window) attach(window);
  return () => {
    if (window && !window.isDestroyed()) detach(window);
  };
};

export const app_window: GitWindow = {
  on_focus: (listener) => on_window((window) => window.on("focus", listener), (window) => window.off("focus", listener)),
  on_blur: (listener) => on_window((window) => window.on("blur", listener), (window) => window.off("blur", listener)),
  focused: () => {
    const window = main_window();
    return Boolean(window && !window.isDestroyed() && window.isFocused());
  },
};

const current_fetcher = (): Fetcher => {
  if (!work) {
    throw new Error("the git view was used before init_git");
  }
  return work.fetcher;
};

const notify = (event: GitEvent) => {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error(`[git] a listener for the ${event.kind} event of ${event.root} failed:`, error);
    }
  }
};

const publish = (root: string, view: GitView, refs: GitRef[]) => {
  bound?.history.retire(view.kind === "repo" ? view.fingerprint : null);
  notify({ kind: "view", root, view, refs });
};

const release = () => {
  if (!bound) return;
  const { root } = bound.session;
  bound.history.close();
  bound.session.stop();
  bound = null;
  notify({ kind: "release", root });
};

const bound_to = (root: string): BoundGit => {
  if (!bound) {
    throw new Error("no git session is running, open the Files panel first");
  }
  if (path_key(bound.session.root) !== path_key(root)) {
    throw new Error("git session is bound to another folder");
  }
  return bound;
};

export const git_service = {
  bind: (root: FilesRoot): TreeTap => {
    if (!bound || path_key(bound.session.root) !== path_key(root.path)) {
      release();
      const session = create_git_session(root, { readers: default_readers, publish, window: app_window, fetcher: current_fetcher() });
      bound = { session, history: create_history(), commits: create_commit_reader() };
    } else {
      bound.session.republish();
      notify({ kind: "rebind", root: bound.session.root });
    }
    const { session } = bound;
    return { path: (event, relative) => session.tree_event(event, relative), failed: () => session.tree_failed() };
  },
  stop: release,
  refresh: (root: string) => {
    bound_to(root).session.refresh();
    notify({ kind: "refresh", root });
  },
  diff: async (root: string, path: string): Promise<GitFileDiff> => read_file_diff(await bound_to(root).session.read_access(), path),
  line_counts: async (root: string): Promise<LineCount[]> => read_line_counts(await bound_to(root).session.read_access()),
  history: (root: string, request: HistoryRequest): Promise<HistoryPage> => {
    const { session, history } = bound_to(root);
    return history.page({ view: session.view, access: session.read_access }, request);
  },
  close_history: () => bound?.history.close(),
  commit: async (root: string, hash: string): Promise<CommitDetail> => {
    const { session, commits } = bound_to(root);
    return commits.detail(await session.read_access(), hash);
  },
  commit_diff: async (root: string, hash: string, path: string): Promise<GitFileDiff> => {
    const { session, commits } = bound_to(root);
    return commits.file_diff(await session.read_access(), hash, path);
  },
  fetch_head: (root: string, head: RemoteHead) => {
    const target = bound_to(root).session.fetch_target();
    if (target) current_fetcher().request_head(target, head);
  },
  work_changed: () => work?.busy.changed(),
  listen: (listener: GitListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const init_git = (sources: WorkSources) => {
  const busy = create_repo_busy(sources);
  work = { busy, fetcher: create_fetcher(busy) };
  git_tool().catch((error) => console.error("[git] locating git.exe at startup failed:", error));
};

export const shutdown_git = () => work?.fetcher.shutdown();
