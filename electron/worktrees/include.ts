import fs from "node:fs/promises";
import path from "node:path";
import { entry_kind, fsmonitor_off } from "../git/repo.ts";
import { exec_git, git_ok, type GitTool } from "../git/run.ts";
import { encoding_batches } from "../project/grep-encoding.ts";

export const include_file = ".worktreeinclude";

const listed = async (tool: GitTool, top: string, args: string[], paths: string[] = []): Promise<string[]> => {
  const output = await exec_git(tool, { cwd: top, args: ["ls-files", "-z", "--others", "--ignored", ...args, ...(paths.length ? ["--", ...paths] : [])], flags: fsmonitor_off, literal_paths: true });
  return git_ok(output, `git ls-files ${args.join(" ")} in ${top}`)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
};

export const copy_included = async (tool: GitTool, main_top: string, worktree_top: string): Promise<string[]> => {
  const patterns = path.join(main_top, include_file);
  if ((await entry_kind(patterns)) !== "file") {
    return [];
  }
  const wanted = await listed(tool, main_top, [`--exclude-from=${patterns}`]);
  const ignored = new Set<string>();
  for (const batch of encoding_batches(wanted)) {
    for (const file of await listed(tool, main_top, ["--exclude-standard"], batch)) {
      ignored.add(file);
    }
  }
  const copied: string[] = [];
  for (const file of wanted.filter((entry) => ignored.has(entry))) {
    const target = path.join(worktree_top, ...file.split("/"));
    if ((await entry_kind(target)) !== null) {
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(main_top, ...file.split("/")), target, fs.constants.COPYFILE_EXCL);
    copied.push(file);
  }
  return copied;
};
