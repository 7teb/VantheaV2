import type { NoGitReason } from "../../shared/turn-diff.ts";
import { repo_config, split_key } from "../git/guard.ts";
import { git_tool, minimum_git, version_at_least } from "../git/locate.ts";
import { detect_repo, fsmonitor_off, type RepoPaths } from "../git/repo.ts";
import { error_line, exec_git, type GitConfigPair, type GitTool } from "../git/run.ts";

export type GitTarget = { kind: "git"; tool: GitTool; paths: RepoPaths; config: GitConfigPair[] };

type Target = GitTarget | { kind: "recorded"; reason: NoGitReason; detail: string };

const fixed_config: GitConfigPair[] = [
  ["core.fsmonitor", "false"],
  ["core.safecrlf", "false"],
  ["core.splitIndex", "false"],
  ["advice.addEmbeddedRepo", "false"],
  ["gc.auto", "0"],
];

const snapshot_config = (keys: string[]): GitConfigPair[] => {
  const filters = new Set(
    keys.flatMap((key) => {
      const { section, subsection } = split_key(key);
      return section === "filter" && subsection !== null ? [subsection] : [];
    }),
  );
  const off = [...filters].sort().flatMap((name): GitConfigPair[] => [
    [`filter.${name}.clean`, ""],
    [`filter.${name}.smudge`, ""],
    [`filter.${name}.process`, ""],
    [`filter.${name}.required`, "false"],
  ]);
  return [...fixed_config, ...off];
};

const ignored_folder = async (tool: GitTool, paths: RepoPaths, signal: AbortSignal): Promise<Target | null> => {
  const folder = paths.prefix.replace(/\/+$/, "");
  if (folder === "") return null;
  const output = await exec_git(tool, { cwd: paths.top, args: ["check-ignore", "-q", "--", folder], flags: fsmonitor_off, signal });
  if (output.code === 0) return { kind: "recorded", reason: "ignored_folder", detail: paths.top };
  if (output.code === 1) return null;
  return { kind: "recorded", reason: "snapshot_failed", detail: `git check-ignore in ${paths.top} exited with ${output.code}: ${error_line(output.stderr) || "no error output"}` };
};

export const resolve_target = async (root: string, signal: AbortSignal): Promise<Target> => {
  const found = await git_tool();
  if (found.kind === "missing") return { kind: "recorded", reason: "git_missing", detail: "" };
  const { tool } = found;
  if (!version_at_least(tool.numbers, minimum_git)) return { kind: "recorded", reason: "git_too_old", detail: tool.version };
  const detected = await detect_repo(tool, root, signal);
  if (detected.kind === "none") return { kind: "recorded", reason: "not_repo", detail: root };
  if (detected.kind === "ownership") return { kind: "recorded", reason: "ownership", detail: detected.path };
  if (detected.kind === "error") return { kind: "recorded", reason: "snapshot_failed", detail: detected.message };
  const { paths } = detected;
  const ignored = await ignored_folder(tool, paths, signal);
  if (ignored) return ignored;
  const entries = await repo_config(tool, paths.top, signal);
  return { kind: "git", tool, paths, config: snapshot_config(entries.map((entry) => entry.key)) };
};
