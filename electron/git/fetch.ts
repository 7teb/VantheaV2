import type { FetchBlock, FetchError, FetchState, GitRemote } from "../../shared/git-view.ts";
import { parse_remote_url, transport_scheme } from "../../shared/git/remote-url.ts";
import { error_text } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import type { RepoBusy } from "./busy.ts";
import { fetch_block, type GuardRules } from "./guard.ts";
import { exec_git, first_line, type GitCall, type GitOutput, type GitTool } from "./run.ts";
import { fetch_ssh_command, ssh_test_command } from "./ssh.ts";

export type FetchTarget = { tool: GitTool; top: string; common_dir: string; remote: GitRemote; guard: GuardRules; fetch_head_at: string | null };

export type FetchCause = "open" | "tick" | "focus" | "refresh";

export type FetchStatus = { at: string | null; running: boolean; error: FetchError | null; paused: boolean; queued: boolean };

export type RemoteHead = { branch: string; sha: string; tracking: string | null };

export type Fetcher = {
  status: (common_dir: string, remote: string) => FetchStatus;
  request: (target: FetchTarget, cause: FetchCause) => void;
  request_head: (target: FetchTarget, head: RemoteHead) => void;
  next_tick: (target: FetchTarget) => number | null;
  on_change: (listener: (common_key: string) => void) => () => void;
  shutdown: () => void;
};

type RemoteRecord = { at: string | null; error: FetchError | null };

type Wanted = { target: FetchTarget; refresh: boolean; head: RemoteHead | null };

type RepoFetch = {
  common_dir: string;
  opened: boolean;
  phase: "idle" | "checking" | "running";
  controller: AbortController | null;
  restart: FetchTarget | null;
  wanted: Wanted | null;
  queued: FetchTarget | null;
  paused: boolean;
  checked: number;
  ended: number;
  remotes: Map<string, RemoteRecord>;
  heads: Map<string, RemoteHead>;
};

export const fetch_period_ms = 180_000;

export const idle_fetch: FetchState = { at: null, running: false, error: null, blocked: null, queued: false };

const insecure_schemes = new Set(["http", "git", "ftp"]);

const fetch_patterns: [RegExp, FetchError["kind"] | "busy"][] = [
  [/terminal prompts disabled|could not read Username|Authentication failed|interactivity has been disabled/i, "auth_required"],
  [/Permission denied \(publickey/i, "ssh_key_rejected"],
  [/Host key verification failed/i, "ssh_host_unknown"],
  [/Repository not found|repository '[^']*' not found/i, "remote_not_found"],
  [/Could not resolve host|Failed to connect|Connection timed out/i, "offline"],
  [/cannot lock ref|Unable to create '[^']*\.lock'/i, "busy"],
];

const plain_remote = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

export type CopyAction = { kind: "fetch" } | { kind: "push"; upstream: string | null };

const head_key = (remote: string, branch: string): string => `${remote}\0${branch}`;

export const insecure_scheme = (url: string): string | null => {
  const scheme = transport_scheme(url);
  return scheme && insecure_schemes.has(scheme) ? scheme : null;
};

export const fetch_blocked = (target: FetchTarget): FetchBlock | null => {
  const scheme = insecure_scheme(target.remote.url);
  if (scheme) return { kind: "insecure_transport", scheme };
  return fetch_block(target.guard, target.remote.name);
};

export const classify_fetch = (stderr: string): FetchError["kind"] | "busy" => fetch_patterns.find(([pattern]) => pattern.test(stderr))?.[1] ?? "error";

const action_command = (remote: string, action: CopyAction): string | null => {
  if (action.kind === "fetch") return `git fetch ${remote}`;
  if (action.upstream === null) return `git push -u ${remote} HEAD`;
  return plain_remote.test(action.upstream) ? `git push ${remote} HEAD:${action.upstream}` : null;
};

const copy_command = (kind: FetchError["kind"], remote: GitRemote, action: CopyAction): string | null => {
  if (kind === "auth_required") return plain_remote.test(remote.name) ? action_command(remote.name, action) : null;
  if (kind === "ssh_key_rejected" || kind === "ssh_host_unknown") return ssh_test_command(remote.url);
  return null;
};

export const fetch_error = (kind: FetchError["kind"], remote: GitRemote, detail: string, action: CopyAction = { kind: "fetch" }): FetchError => ({
  kind,
  remote: remote.name,
  host: parse_remote_url(remote.url).host,
  detail,
  command: copy_command(kind, remote, action),
});

export const fetch_call = (target: FetchTarget, signal?: AbortSignal): GitCall => ({
  cwd: target.top,
  flags: ["-c", "maintenance.auto=false"],
  args: ["fetch", "--no-write-fetch-head", "--recurse-submodules=no", "--quiet", "--", target.remote.name],
  config: target.guard.read_config,
  env: { GIT_SSH_COMMAND: fetch_ssh_command(process.env, target.guard.ssh) },
  signal,
});

const time_of = (iso: string | null): number => (iso === null ? 0 : Date.parse(iso) || 0);

const latest = (left: string | null, right: string | null): string | null => (time_of(right) > time_of(left) ? right : left);

export const fetch_state = (fetcher: Fetcher, target: FetchTarget): FetchState => {
  const status = fetcher.status(target.common_dir, target.remote.name);
  const blocked = fetch_blocked(target);
  return {
    at: latest(status.at, target.fetch_head_at),
    running: status.running,
    error: blocked ? null : status.error,
    blocked: blocked ?? (status.paused ? { kind: "agent_running" } : null),
    queued: status.queued,
  };
};

export const create_fetcher = (busy: RepoBusy): Fetcher => {
  const repos = new Map<string, RepoFetch>();
  const listeners = new Set<(common_key: string) => void>();
  let closed = false;
  let work_epoch = 0;

  const repo_of = (common_dir: string): RepoFetch => {
    const key = path_key(common_dir);
    const known = repos.get(key);
    if (known) return known;
    const created: RepoFetch = { common_dir, opened: false, phase: "idle", controller: null, restart: null, wanted: null, queued: null, paused: false, checked: 0, ended: 0, remotes: new Map(), heads: new Map() };
    repos.set(key, created);
    return created;
  };

  const changed = (repo: RepoFetch) => {
    const key = path_key(repo.common_dir);
    for (const listener of listeners) {
      try {
        listener(key);
      } catch (error) {
        console.error(`[git] a fetch listener for ${repo.common_dir} failed:`, error);
      }
    }
  };

  const record = (repo: RepoFetch, remote: string): RemoteRecord => {
    const known = repo.remotes.get(remote);
    if (known) return known;
    const created: RemoteRecord = { at: null, error: null };
    repo.remotes.set(remote, created);
    return created;
  };

  const settle = (repo: RepoFetch, target: FetchTarget, output: GitOutput) => {
    const entry = record(repo, target.remote.name);
    if (output.code === 0) {
      entry.at = new Date().toISOString();
      entry.error = null;
      return;
    }
    const kind = classify_fetch(output.stderr);
    if (kind === "busy") return;
    entry.error = fetch_error(kind, target.remote, first_line(output.stderr));
  };

  const run = async (repo: RepoFetch, target: FetchTarget) => {
    const controller = new AbortController();
    const started_epoch = work_epoch;
    let exited = () => {};
    const gone = new Promise<void>((resolve) => {
      exited = resolve;
    });
    repo.phase = "running";
    repo.controller = controller;
    changed(repo);
    try {
      settle(repo, target, await exec_git(target.tool, { ...fetch_call(target, controller.signal), on_exit: exited }));
    } catch (error) {
      if (controller.signal.aborted) {
        await gone;
      } else {
        console.error(`[git] fetching ${target.remote.name} in ${target.top} failed:`, error);
        record(repo, target.remote.name).error = fetch_error("error", target.remote, error_text(error));
      }
    } finally {
      const next = repo.restart;
      Object.assign(repo, { phase: "idle", controller: null, restart: null, ended: Date.now() });
      changed(repo);
      if (next && !closed) launch(repo, { target: next, refresh: true, head: null });
      else if (!closed && work_epoch !== started_epoch) launch(repo, null);
    }
  };

  const check = async (repo: RepoFetch): Promise<boolean> => {
    for (;;) {
      const seen = work_epoch;
      const in_use = await busy.in_use(repo.common_dir);
      if (seen === work_epoch || closed) return in_use;
    }
  };

  const hold = (repo: RepoFetch) => {
    if (repo.wanted) repo.checked = Date.now();
    Object.assign(repo, { phase: "idle", wanted: null });
    changed(repo);
  };

  const start = async (repo: RepoFetch, first: Wanted | null) => {
    repo.phase = "checking";
    repo.wanted = first;
    let in_use: boolean;
    try {
      in_use = await check(repo);
    } catch (error) {
      console.error(`[git] checking whether agents work in ${repo.common_dir} failed:`, error);
      hold(repo);
      return;
    }
    const wanted = repo.wanted;
    if (closed || in_use) {
      repo.paused = in_use;
      if (in_use && wanted?.refresh) repo.queued = wanted.target;
      hold(repo);
      return;
    }
    const next = wanted?.target ?? repo.queued;
    Object.assign(repo, { wanted: null, paused: false, queued: null });
    if (next && wanted?.head) repo.heads.set(head_key(next.remote.name, wanted.head.branch), wanted.head);
    if (next) return run(repo, next);
    repo.phase = "idle";
    changed(repo);
  };

  const launch = (repo: RepoFetch, first: Wanted | null) => {
    start(repo, first).catch((error) => console.error(`[git] the fetch in ${repo.common_dir} failed:`, error));
  };

  busy.on_change(() => {
    work_epoch += 1;
    for (const repo of repos.values()) {
      if (!closed && repo.phase === "idle") launch(repo, null);
    }
  });

  return {
    status: (common_dir, remote) => {
      const repo = repos.get(path_key(common_dir));
      const entry = repo?.remotes.get(remote);
      return { at: entry?.at ?? null, running: repo?.phase === "running", error: entry?.error ?? null, paused: repo?.paused ?? false, queued: Boolean(repo?.queued) };
    },
    request: (target, cause) => {
      if (closed || fetch_blocked(target)) return;
      const repo = repo_of(target.common_dir);
      if (cause === "open" && repo.opened) return;
      repo.opened = true;
      if ((cause === "tick" || cause === "focus") && Date.now() - Math.max(repo.ended, time_of(target.fetch_head_at)) < fetch_period_ms) return;
      const refresh = cause === "refresh";
      if (repo.phase === "running") {
        if (!refresh) return;
        repo.restart = target;
        repo.controller?.abort(new Error(`refresh restarts the fetch of ${target.remote.name} in ${target.top}`));
        return;
      }
      if (repo.phase === "checking") {
        repo.wanted = { target, refresh: refresh || Boolean(repo.wanted?.refresh), head: repo.wanted?.head ?? null };
        return;
      }
      launch(repo, { target, refresh, head: null });
    },
    request_head: (target, head) => {
      if (closed || head.sha === head.tracking || fetch_blocked(target)) return;
      const repo = repo_of(target.common_dir);
      const seen = repo.heads.get(head_key(target.remote.name, head.branch));
      if ((seen && seen.sha === head.sha && seen.tracking === head.tracking) || repo.phase === "running") return;
      if (repo.phase === "checking") {
        repo.wanted = { target, refresh: Boolean(repo.wanted?.refresh), head };
        return;
      }
      launch(repo, { target, refresh: false, head });
    },
    next_tick: (target) => {
      if (closed || fetch_blocked(target)) return null;
      const repo = repos.get(path_key(target.common_dir));
      if (repo && repo.phase !== "idle") return null;
      const last = Math.max(repo?.ended ?? 0, repo?.checked ?? 0, time_of(target.fetch_head_at));
      return Math.max(0, last + fetch_period_ms - Date.now());
    },
    on_change: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    shutdown: () => {
      closed = true;
      for (const repo of repos.values()) {
        repo.queued = null;
        repo.wanted = null;
        repo.restart = null;
        repo.controller?.abort(new Error("the app is quitting"));
      }
    },
  };
};

export type GitWindow = {
  on_focus: (listener: () => void) => () => void;
  on_blur: (listener: () => void) => () => void;
  focused: () => boolean;
};

type FetchLink = { sync: () => void; refresh: () => void; stop: () => void };

export const link_fetch = (fetcher: Fetcher, window: GitWindow, target_of: () => FetchTarget | null, on_change: () => void): FetchLink => {
  let opened = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    const target = target_of();
    if (!target || !window.focused()) return;
    const wait = fetcher.next_tick(target);
    if (wait === null) return;
    timer = setTimeout(() => {
      timer = null;
      request("tick");
    }, wait);
  };

  const request = (cause: FetchCause) => {
    const target = target_of();
    if (target) fetcher.request(target, cause);
    schedule();
  };

  const change_off = fetcher.on_change((common_key) => {
    const target = target_of();
    if (!target || path_key(target.common_dir) !== common_key) return;
    on_change();
    schedule();
  });
  const focus_off = window.on_focus(() => request("focus"));
  const blur_off = window.on_blur(clear);

  return {
    sync: () => {
      if (!opened && target_of()) {
        opened = true;
        request("open");
        return;
      }
      if (!timer) schedule();
    },
    refresh: () => request("refresh"),
    stop: () => {
      clear();
      change_off();
      focus_off();
      blur_off();
    },
  };
};
