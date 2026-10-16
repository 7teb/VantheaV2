import type { GitRemote } from "../../shared/git-view.ts";
import { parse_remote_url, strip_userinfo } from "../../shared/git/remote-url.ts";
import type { FetchHead } from "./refs.ts";
import { exec_git, git_ok, type GitConfigPair, type GitTool } from "./run.ts";

export type RemotesRead = { raw: Buffer; remotes: GitRemote[] };

const remote_line = /^([^\t]+)\t(.*) \((fetch|push)\)(?: \[[^\]]*\])?$/;

export const parse_remotes = (text: string): GitRemote[] => {
  const urls = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = remote_line.exec(line.replace(/\r$/, ""));
    if (!match) continue;
    const name = match[1] ?? "";
    if (match[3] === "fetch" || !urls.has(name)) urls.set(name, strip_userinfo(match[2] ?? ""));
  }
  return [...urls].map(([name, url]) => {
    const parsed = parse_remote_url(url);
    return { name, url, host: parsed.host, host_kind: parsed.host_kind, slug: parsed.slug };
  });
};

export const primary_remote = (remotes: GitRemote[], upstream: string | null): string | null => {
  const tracked = upstream
    ? remotes
        .filter((remote) => upstream.startsWith(`${remote.name}/`))
        .sort((left, right) => right.name.length - left.name.length)[0]
    : undefined;
  if (tracked) return tracked.name;
  if (remotes.some((remote) => remote.name === "origin")) return "origin";
  return remotes.length === 1 ? (remotes[0]?.name ?? null) : null;
};

const fetch_head_url = (url: string): string => {
  const anonymous = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? strip_userinfo(url) : url.replace(/^[^@/:]+@(?=[^/:]{2,}:)/, "");
  return anonymous.replace(/\/+$/, "").replace(/\.git$/, "");
};

export const last_fetch_at = (fetch_head: FetchHead | null, url: string): string | null => {
  if (!fetch_head) return null;
  const wanted = ` of ${fetch_head_url(url)}`;
  const named = fetch_head.text.split("\n").some((line) => line.replace(/\r$/, "").endsWith(wanted));
  return named ? new Date(fetch_head.mtime_ms).toISOString() : null;
};

export const read_remotes = async (tool: GitTool, root: string, config: GitConfigPair[], signal?: AbortSignal): Promise<RemotesRead> => {
  const raw = git_ok(await exec_git(tool, { cwd: root, args: ["remote", "-v"], config, signal }), `git remote -v in ${root}`);
  return { raw, remotes: parse_remotes(raw.toString("utf8")) };
};
