import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import type { GitView } from "../shared/git-view.ts";
import type { FilesRoot } from "../shared/ipc/files.ts";
import { git_tool, minimum_git, version_at_least } from "../electron/git/locate.ts";
import type { Fetcher, GitWindow } from "../electron/git/fetch.ts";
import type { GitTool } from "../electron/git/run.ts";
import { default_readers, type GitReaders } from "../electron/git/readers.ts";
import { create_git_session } from "../electron/git/session.ts";

process.env.GIT_CEILING_DIRECTORIES = os.tmpdir();

const roots: string[] = [];

after(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const found = await git_tool().catch((error: unknown) => {
  console.warn(`[test] locating git failed, real git cases are skipped: ${String(error)}`);
  return null;
});

export const real_git: GitTool | null = found?.kind === "found" && version_at_least(found.tool.numbers, minimum_git) ? found.tool : null;

export const skip_without_git = real_git ? false : "Git for Windows 2.33 or newer was not found on this PC";

export const tool = (): GitTool => {
  if (!real_git) throw new Error("real git is required for this case");
  return real_git;
};

export const quiet_window: GitWindow = { on_focus: () => () => undefined, on_blur: () => () => undefined, focused: () => false };

export const quiet_fetcher: Fetcher = {
  status: () => ({ at: null, running: false, error: null, paused: false, queued: false }),
  request: () => undefined,
  request_head: () => undefined,
  next_tick: () => null,
  on_change: () => () => undefined,
  shutdown: () => undefined,
};

export const scratch = async (prefix: string): Promise<string> => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `vx-${prefix}-`)));
  roots.push(root);
  return root;
};

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    tool().exe,
    ["-c", "user.name=VantheaX Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", "-c", "init.defaultBranch=main", ...args],
    { cwd, stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
  ).toString("utf8");

export const git_status = (cwd: string, ...args: string[]): number => {
  try {
    git(cwd, ...args);
    return 0;
  } catch (error) {
    return typeof (error as { status?: unknown }).status === "number" ? ((error as { status: number }).status) : -1;
  }
};

export const write = async (root: string, files: Record<string, string>) => {
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }
};

export const repo_with = async (prefix: string, files: Record<string, string>): Promise<string> => {
  const root = await scratch(prefix);
  git(root, "init", "-q", "-b", "main");
  await write(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
};

export const posix = (value: string): string => value.replace(/\\/g, "/");

export const marker = async (): Promise<{ dir: string; file: string; ran: () => Promise<boolean> }> => {
  const dir = await scratch("marker");
  const file = path.join(dir, "marker.txt");
  return { dir, file: posix(file), ran: async () => (await fs.readFile(file, "utf8").catch(() => "")).length > 0 };
};

export const touch_future = async (file: string, offset_s = 3600) => {
  const when = new Date(Date.now() + offset_s * 1000);
  await fs.utimes(file, when, when);
};

export const first_view = (root: string, kind: FilesRoot["kind"] = "project", readers: Partial<GitReaders> = {}): Promise<GitView> =>
  new Promise((resolve, reject) => {
    const session = create_git_session(
      { path: root, name: path.basename(root), kind },
      {
        readers: { ...default_readers, ...readers },
        publish: (_root, view) => {
          if (view.kind === "loading") return;
          session.stop();
          resolve(view);
        },
        window: quiet_window,
        fetcher: quiet_fetcher,
      },
    );
    setTimeout(() => {
      session.stop();
      reject(new Error(`no git view for ${root} within 20 s`));
    }, 20_000).unref();
  });
