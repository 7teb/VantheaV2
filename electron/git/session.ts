import { existsSync, type WatchEventType } from "node:fs";
import path from "node:path";
import type { FetchState, GitRemote, GitView } from "../../shared/git-view.ts";
import type { FilesRoot } from "../../shared/ipc/files.ts";
import { error_text } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import type { GitReadAccess } from "./diff.ts";
import { fetch_state, idle_fetch, link_fetch, type Fetcher, type FetchTarget, type GitWindow } from "./fetch.ts";
import type { GitGuard } from "./guard.ts";
import { minimum_git, partial_clone_git, version_at_least } from "./locate.ts";
import type { GitReaders } from "./readers.ts";
import type { GitRef } from "./refs.ts";
import { last_fetch_at } from "./remotes.ts";
import { own_worktree, same_paths, type RepoPaths } from "./repo.ts";
import { git_failure_line, type GitTool, type GitVersion } from "./run.ts";
import { create_ssh_hosts } from "./ssh.ts";
import { parse_project_status, same_status } from "./status.ts";
import { assemble_view, special_of, type ViewParts } from "./view.ts";
import { tree_collector, type GitDirWatch, type GitWatchDir, type GitWatchKind } from "./watch.ts";

export type SessionDeps = {
  readers: GitReaders;
  publish: (root: string, view: GitView, refs: GitRef[]) => void;
  window: GitWindow;
  fetcher: Fetcher;
};

export type GitSession = {
  root: string;
  view: () => GitView;
  republish: () => void;
  refresh: () => void;
  tree_event: (event: WatchEventType, relative: string | null) => void;
  tree_failed: () => void;
  read_access: () => Promise<GitReadAccess>;
  fetch_target: () => FetchTarget | null;
  stop: () => void;
};

type Part = "status" | "refs" | "remotes";

type Job = "detect" | "detect_full" | Part;

export const slow_status_ms = 400;

const job_of = (kind: GitWatchKind): Job => (kind === "detect" ? "detect_full" : kind);

export const create_git_session = (root: FilesRoot, deps: SessionDeps): GitSession => {
  const { readers } = deps;
  const controller = new AbortController();
  const pending = new Set<Job>();
  const running = new Set<Job>();
  const parts: ViewParts = { root_kind: root.kind, special: null, failures: new Map(), paths: null, status: null, operation: null, refs: null, remotes: null, refreshing: false, watch_failed: false };
  let stopped = false;
  let epoch = 0;
  let tool: GitTool | null = null;
  let guard: GitGuard | null = null;
  let needed: GitVersion = minimum_git;
  let dir_watch: GitDirWatch | null = null;
  let dir_key = "";
  let slow_runs = 0;
  let dirty = true;
  let published: GitView = { kind: "none" };
  let published_refs: GitRef[] = [];
  let published_any = false;

  const target_for = (remote: GitRemote, fetch_head_at: string | null): FetchTarget | null =>
    tool && guard && parts.paths ? { tool, guard, top: parts.paths.top, common_dir: parts.paths.common_dir, remote, fetch_head_at } : null;

  const fetch_of = (remote: GitRemote, fetch_head_at: string | null): FetchState => {
    const target = target_for(remote, fetch_head_at);
    return target ? fetch_state(deps.fetcher, target) : { ...idle_fetch, at: fetch_head_at };
  };

  const fetch_target = (): FetchTarget | null => {
    const view = published;
    const remote = view.kind === "repo" ? view.remotes.find((entry) => entry.name === view.primary_remote) : undefined;
    return remote ? target_for(remote, last_fetch_at(parts.refs?.fetch_head ?? null, remote.url)) : null;
  };

  const ssh_hosts = create_ssh_hosts({ env: process.env, exists: existsSync }, controller.signal, () => {
    dirty = true;
    flush();
  });

  const flush = () => {
    if (stopped || !dirty) return;
    dirty = false;
    if (tool && guard && parts.remotes) ssh_hosts.request(parts.remotes.remotes, tool, guard.ssh);
    const remotes = parts.remotes && { ...parts.remotes, remotes: ssh_hosts.apply(parts.remotes.remotes) };
    published = assemble_view({ ...parts, remotes }, fetch_of);
    published_refs = parts.refs?.refs ?? [];
    published_any = true;
    deps.publish(root.path, published, published_refs);
    link.sync();
  };

  const set_special = (view: GitView | null) => {
    if (JSON.stringify(view) !== JSON.stringify(parts.special)) {
      parts.special = view;
      dirty = true;
    }
  };

  const close_dir_watch = () => {
    dir_watch?.close();
    dir_watch = null;
    dir_key = "";
  };

  const settle_special = (view: GitView) => {
    tool = null;
    guard = null;
    Object.assign(parts, { paths: null, status: null, operation: null, refs: null, remotes: null });
    parts.failures.clear();
    close_dir_watch();
    set_special(view);
  };

  const fail = (part: Part | "guard", ticket: number, error: unknown) => {
    if (stopped || ticket !== epoch) return;
    console.warn(`[git] reading ${part} in ${root.path} failed: ${error_text(error)}`);
    parts.failures.set(part, git_failure_line(error) ?? error_text(error));
    dirty = true;
  };

  const succeed = (part: Part | "guard") => {
    if (parts.failures.delete(part)) dirty = true;
  };

  const slow_timer = () => {
    slow_runs += 1;
    const timer = setTimeout(() => {
      if (!parts.refreshing && published.kind === "repo") {
        parts.refreshing = true;
        dirty = true;
        flush();
      }
    }, slow_status_ms);
    return () => {
      clearTimeout(timer);
      slow_runs -= 1;
      if (slow_runs === 0 && parts.refreshing) {
        parts.refreshing = false;
        dirty = true;
      }
    };
  };

  const read_part = async (part: Part, ticket: number, guard_fresh: boolean) => {
    const current = tool && guard && parts.paths ? { tool, guard, paths: parts.paths } : null;
    if (!current) return;
    const config = current.guard.read_config;
    try {
      if (part === "status") {
        const checked = guard_fresh ? current.guard : await accept_guard(ticket, current.tool, current.paths, current.guard);
        if (!checked) return;
        const raw = await readers.status(current.tool, root.path, checked.read_config, controller.signal);
        const [next, operation] = await Promise.all([parse_project_status(raw, current.paths), readers.operation(current.paths.git_dir)]);
        if (ticket !== epoch) return;
        if (!same_status(parts.status, next)) {
          parts.status = next;
          dirty = true;
        }
        if (JSON.stringify(operation) !== JSON.stringify(parts.operation)) {
          parts.operation = operation;
          dirty = true;
        }
      }
      if (part === "refs") {
        const next = await readers.refs(current.tool, root.path, current.paths.git_dir, config, controller.signal);
        if (ticket !== epoch) return;
        if (!parts.refs || !parts.refs.raw.equals(next.raw) || parts.refs.fetch_head?.mtime_ms !== next.fetch_head?.mtime_ms) {
          parts.refs = next;
          dirty = true;
        }
      }
      if (part === "remotes") {
        const next = await readers.remotes(current.tool, root.path, config, controller.signal);
        if (ticket !== epoch) return;
        if (!parts.remotes || !parts.remotes.raw.equals(next.raw)) {
          parts.remotes = next;
          dirty = true;
        }
      }
      succeed(part);
    } catch (error) {
      fail(part, ticket, error);
    }
  };

  const read_parts = async (ticket: number, wanted: Part[], guard_fresh = false) => {
    const done = wanted.includes("status") ? slow_timer() : null;
    try {
      await Promise.all(wanted.map((part) => read_part(part, ticket, guard_fresh)));
    } finally {
      done?.();
    }
  };

  const watcher_failed = () => {
    if (parts.watch_failed || stopped) return;
    parts.watch_failed = true;
    close_dir_watch();
    dirty = true;
    request(["detect_full"]);
  };

  const watch_dirs = (paths: RepoPaths) => {
    const key = `${path_key(paths.common_dir)}|${path_key(paths.git_dir)}`;
    if (parts.watch_failed || (dir_watch && key === dir_key)) return;
    close_dir_watch();
    const dirs: GitWatchDir[] = [{ dir: paths.common_dir, own_worktree: own_worktree(paths) }];
    const common = path_key(paths.common_dir);
    const own = path_key(paths.git_dir);
    if (own !== common && !own.startsWith(`${common}/`)) dirs.push({ dir: paths.git_dir, own_worktree: null });
    dir_key = key;
    dir_watch = readers.watch(dirs, (kinds) => request(kinds.map(job_of)), watcher_failed);
  };

  const accept_guard = async (ticket: number, current: GitTool, paths: RepoPaths, previous: GitGuard | null): Promise<GitGuard | null> => {
    let next: GitGuard;
    try {
      next = await readers.guard(current, paths, previous, controller.signal);
    } catch (error) {
      if (ticket === epoch) guard = null;
      fail("guard", ticket, error);
      return null;
    }
    if (ticket !== epoch) return null;
    guard = next;
    succeed("guard");
    if (next.partial_clone && !version_at_least(current.numbers, partial_clone_git)) {
      needed = partial_clone_git;
      settle_special({ kind: "git_too_old", version: current.version, reason: "partial_clone" });
      return null;
    }
    needed = minimum_git;
    return next;
  };

  const detect_run = async (full: boolean) => {
    const ticket = ++epoch;
    const found = await readers.tool(needed, full);
    if (ticket !== epoch) return;
    if (found.kind === "missing" || !version_at_least(found.tool.numbers, minimum_git)) {
      const location = await readers.location(root.path);
      if (ticket !== epoch) return;
      needed = minimum_git;
      settle_special(!location ? { kind: "none" } : found.kind === "missing" ? { kind: "git_missing" } : { kind: "git_too_old", version: found.tool.version, reason: "minimum" });
      return flush();
    }
    const current = found.tool;
    const detected = await readers.detect(current, root.path, controller.signal);
    if (ticket !== epoch) return;
    if (detected.kind !== "repo") {
      settle_special(special_of(detected));
      return flush();
    }
    const same = parts.paths !== null && same_paths(parts.paths, detected.paths) && tool !== null && guard !== null;
    tool = current;
    parts.paths = detected.paths;
    set_special(null);
    const guard_fresh = !same || full;
    if (guard_fresh && !(await accept_guard(ticket, current, detected.paths, null))) return flush();
    watch_dirs(detected.paths);
    await read_parts(ticket, guard_fresh ? ["status", "refs", "remotes"] : ["status", "refs"], guard_fresh);
    flush();
  };

  const part_run = async (part: Part) => {
    await read_parts(epoch, [part]);
    flush();
  };

  const launch = (job: Job, work: () => Promise<void>) => {
    running.add(job);
    work()
      .catch((error) => {
        if (!stopped) console.error(`[git] ${job} run in ${root.path} failed:`, error);
      })
      .finally(() => {
        running.delete(job);
        pump();
      });
  };

  const pump = () => {
    if (stopped || running.has("detect") || running.has("detect_full")) return;
    if (pending.has("detect") || pending.has("detect_full")) {
      const full = pending.has("detect_full");
      const covered: Job[] = full ? ["detect", "detect_full", "status", "refs", "remotes"] : ["detect", "status", "refs"];
      for (const job of covered) pending.delete(job);
      launch(full ? "detect_full" : "detect", () => detect_run(full));
      return;
    }
    for (const part of ["status", "refs", "remotes"] as const) {
      if (pending.has(part) && !running.has(part)) {
        pending.delete(part);
        launch(part, () => part_run(part));
      }
    }
  };

  const request = (jobs: Job[]) => {
    if (stopped) return;
    for (const job of jobs) pending.add(job);
    pump();
  };

  const tree = tree_collector((kinds) => request(kinds.map(job_of)));
  const focus_off = deps.window.on_focus(() => request(["detect"]));
  const link = link_fetch(deps.fetcher, deps.window, fetch_target, () => {
    if (parts.watch_failed) request(["status", "refs"]);
    const target = fetch_target();
    if (published.kind === "repo" && target && JSON.stringify(fetch_state(deps.fetcher, target)) === JSON.stringify(published.fetch)) return;
    dirty = true;
    flush();
  });

  const tree_event = (event: WatchEventType, relative: string | null) => {
    if (event !== "change" || relative !== ".git") {
      tree.add(relative);
      return;
    }
    const dot_git = path.join(root.path, ".git");
    readers
      .entry_kind(dot_git)
      .then((kind) => {
        if (kind !== "dir" && !stopped) tree.add(relative);
      })
      .catch((error) => console.error(`[git] checking ${dot_git} after a change event failed:`, error));
  };

  const read_access = async (): Promise<GitReadAccess> => {
    const view = published;
    const refs = published_refs;
    const current = tool;
    const paths = parts.paths;
    if (stopped || !current || !guard || !paths || view.kind !== "repo") {
      throw new Error(`the git view of ${root.path} shows no repository right now`);
    }
    const fresh = await readers.guard(current, paths, guard, controller.signal);
    if (fresh.partial_clone && !version_at_least(current.numbers, partial_clone_git)) {
      request(["detect_full"]);
      throw new Error(`${paths.top} is a partial clone, which Git ${current.version} cannot read without fetching`);
    }
    return { tool: current, root: root.path, config: fresh.read_config, view, refs, signal: controller.signal };
  };

  request(["detect_full"]);
  readers
    .location(root.path)
    .then((location) => {
      if (location && !stopped && !published_any) {
        published = { kind: "loading" };
        published_any = true;
        deps.publish(root.path, published, []);
      }
    })
    .catch((error) => console.error(`[git] looking for .git above ${root.path} failed:`, error));

  return {
    root: root.path,
    view: () => published,
    republish: () => {
      if (published_any && !stopped) deps.publish(root.path, published, published_refs);
    },
    refresh: () => {
      request(["detect_full"]);
      link.refresh();
    },
    tree_event,
    tree_failed: watcher_failed,
    read_access,
    fetch_target,
    stop: () => {
      if (stopped) return;
      stopped = true;
      epoch += 1;
      pending.clear();
      controller.abort(new Error(`the git session for ${root.path} stopped`));
      close_dir_watch();
      tree.close();
      focus_off();
      link.stop();
    },
  };
};
