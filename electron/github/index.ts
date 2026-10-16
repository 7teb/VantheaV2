import { existsSync } from "node:fs";
import { net } from "electron";
import type { GithubRepoView } from "../../shared/github-view.ts";
import { app_window, git_service, type GitEvent } from "../git/index.ts";
import { path_key } from "../storage/paths.ts";
import { create_github_client, net_transport, type GithubClient } from "./client.ts";
import { create_gh_cache, gh_transport, run_gh, type GhCache } from "./gh-cli.ts";
import { create_repo_session, github_target, type RepoMemory, type RepoSession, type RepoSessionDeps } from "./repo-session.ts";

type ViewListener = (root: string, view: GithubRepoView) => void;

const listeners = new Set<ViewListener>();

const shown = new Set<string>();

const remembered = new Map<string, RepoMemory>();

let github: { client: GithubClient; gh: GhCache; off: () => void } | null = null;

let bound: { root: string; session: RepoSession } | null = null;

const publish = (root: string, view: GithubRepoView) => {
  if (view.kind === "none") shown.delete(path_key(root));
  else shown.add(path_key(root));
  for (const listener of listeners) {
    try {
      listener(root, view);
    } catch (error) {
      console.error(`[github] a listener for the GitHub view of ${root} failed:`, error);
    }
  }
};

const stop_bound = () => {
  if (!bound) return;
  const memory = bound.session.memory();
  if (memory) remembered.set(path_key(bound.root), memory);
  bound.session.stop();
  bound = null;
};

const bound_at = (root: string): RepoSession | null => (bound && path_key(bound.root) === path_key(root) ? bound.session : null);

const on_git = (event: GitEvent) => {
  if (!github) return;
  if (event.kind === "release") {
    if (bound_at(event.root)) stop_bound();
    return;
  }
  if (event.kind === "rebind" || event.kind === "refresh") {
    const session = bound_at(event.root);
    if (event.kind === "rebind") session?.republish();
    else session?.refresh();
    return;
  }
  if (event.view.kind === "loading") return;
  if (bound && !bound_at(event.root)) stop_bound();
  const target = github_target(event.view, event.refs);
  if (!target) {
    stop_bound();
    if (shown.has(path_key(event.root))) publish(event.root, { kind: "none" });
    return;
  }
  const session = bound_at(event.root);
  if (session) {
    session.update(target);
    return;
  }
  const { root } = event;
  const deps: RepoSessionDeps = {
    client: github.client,
    gh: github.gh,
    window: app_window,
    publish: (view) => publish(root, view),
    fetch_head: (head) => git_service.fetch_head(root, head),
  };
  bound = { root, session: create_repo_session(target, deps, remembered.get(path_key(root)) ?? null) };
};

export const github_service = {
  on_view: (listener: ViewListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const init_github = () => {
  const gh = create_gh_cache({ env: process.env, exists: existsSync, run: run_gh });
  const client = create_github_client({ anonymous: net_transport((url, init) => net.fetch(url, init)), gh: gh_transport(gh.exe, run_gh) });
  github = { client, gh, off: git_service.listen(on_git) };
};

export const shutdown_github = () => {
  stop_bound();
  remembered.clear();
  github?.off();
  github = null;
};
