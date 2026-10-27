import fs from "node:fs/promises";
import path from "node:path";
import { parse_numstat, type NumstatRecord } from "../../shared/git/numstat-parse.ts";
import { estimate_tokens } from "../context/estimate.ts";
import { is_secret_path } from "../../shared/secret-path.ts";
import { error_text } from "../storage/coerce.ts";
import { decode_text, looks_binary } from "../storage/text-codec.ts";
import { diff_flags, no_index_refresh, type GitReadAccess } from "./diff.ts";
import { exec_git, git_ok, type GitOutput } from "./run.ts";

export type ChangeRange = { kind: "working" } | { kind: "branch"; base_ref: string };

type Candidate = { path: string; orig_path: string | null; line: string; floor: number; untracked: boolean };

type Read = { block: string } | { note: string };

type Run = (args: string[], literal?: boolean) => Promise<GitOutput>;

const size_note = " (diff left out for size)";

const max_args_chars = 30_000;

const patch_flags = ["-M", "-U3", "--relative", "--src-prefix=a/", "--dst-prefix=b/", ...diff_flags];

const nul_list = (output: GitOutput, what: string): string[] => git_ok(output, what).toString("utf8").split("\0").filter(Boolean);

const record_key = (path_name: string, orig_path: string | null): string => `${orig_path ?? ""}\0${path_name}`;

const record_line = (record: NumstatRecord): string => `${record.orig_path === null ? "" : `${record.orig_path} -> `}${record.path} +${record.added ?? 0} -${record.removed ?? 0}`;

const new_file_block = (name: string, text: string): string => {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return [`diff --git a/${name} b/${name}`, "new file", "--- /dev/null", `+++ b/${name}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`), ""].join("\n");
};

const split_patches = (bytes: Buffer): Buffer[] => {
  const marker = Buffer.from("diff --git ");
  const starts: number[] = [];
  for (let at = bytes.indexOf(marker); at >= 0; at = bytes.indexOf(marker, at + 1)) {
    if (at === 0 || bytes[at - 1] === 10) starts.push(at);
  }
  return starts.map((start, index) => bytes.subarray(start, starts[index + 1] ?? bytes.length));
};

const read_tracked = async (run: Run, base: string, batch: Candidate[]): Promise<Map<string, Read>> => {
  const paths = batch.flatMap((candidate) => (candidate.orig_path === null ? [candidate.path] : [candidate.orig_path, candidate.path]));
  const output = await run(["-c", "core.quotePath=false", "diff", base, "--numstat", "-p", "-z", ...patch_flags, "--", ...paths], true);
  const bytes = git_ok(output, `git diff ${base} for ${paths.length} paths`);
  const split = bytes.indexOf("\0\0");
  const records = parse_numstat(bytes.subarray(0, split < 0 ? bytes.length : split + 1).toString("utf8"));
  const patches = split < 0 ? [] : split_patches(bytes.subarray(split + 2));
  if (patches.length !== records.length) {
    throw new Error(`git diff ${base} printed ${records.length} file records but ${patches.length} patches`);
  }
  return new Map(records.map((record, index) => [record_key(record.path, record.orig_path), { block: decode_text(patches[index] ?? Buffer.alloc(0)).text }]));
};

const read_untracked = async (dir: string, candidate: Candidate): Promise<Read> => {
  try {
    const text = decode_text(await fs.readFile(path.join(dir, candidate.path))).text;
    return looks_binary(text) ? { note: `${candidate.path} (binary)` } : { block: new_file_block(candidate.path, text) };
  } catch (error) {
    console.warn(`[git] reading the new file ${candidate.path} in ${dir} failed: ${error_text(error)}`);
    return { note: `${candidate.line} (not readable)` };
  }
};

const read_batch = async (run: Run, dir: string, base: string, batch: Candidate[]): Promise<Map<Candidate, Read>> => {
  const tracked = batch.filter((candidate) => !candidate.untracked);
  const found = tracked.length > 0 ? await read_tracked(run, base, tracked) : new Map<string, Read>();
  const reads = new Map<Candidate, Read>();
  for (const candidate of batch) {
    const read = candidate.untracked ? await read_untracked(dir, candidate) : found.get(record_key(candidate.path, candidate.orig_path));
    if (!read) console.warn(`[git] the diff of ${candidate.path} in ${dir} came back without its patch, it is named without content`);
    reads.set(candidate, read ?? { note: `${candidate.line} (diff not readable)` });
  }
  return reads;
};

const next_batch = (sorted: Candidate[], from: number, room: number): Candidate[] => {
  const batch: Candidate[] = [];
  let floor = 0;
  let chars = 0;
  for (const candidate of sorted.slice(from)) {
    const length = candidate.path.length + (candidate.orig_path?.length ?? 0) + 2;
    if (batch.length > 0 && (floor + candidate.floor > room || chars + length > max_args_chars)) break;
    if (candidate.floor > room) break;
    batch.push(candidate);
    floor += candidate.floor;
    chars += length;
  }
  return batch;
};

const untracked_candidate = async (dir: string, name: string): Promise<Candidate | string> => {
  if (name.endsWith("/")) return `${name} (own repository, not included)`;
  if (is_secret_path(name)) return `${name} (secret file, content not shown)`;
  try {
    const info = await fs.stat(path.join(dir, name));
    return { path: name, orig_path: null, line: `${name} (new file)`, floor: Math.ceil(info.size / 8), untracked: true };
  } catch (error) {
    console.warn(`[git] reading the size of the new file ${name} in ${dir} failed: ${error_text(error)}`);
    return `${name} (new file, not readable)`;
  }
};

const tracked_candidate = (record: NumstatRecord): Candidate | string => {
  if (is_secret_path(record.path)) return `${record.path} (secret file, content not shown)`;
  if (record.added === null || record.removed === null) return `${record_line(record)} (binary)`;
  return { path: record.path, orig_path: record.orig_path, line: record_line(record), floor: Math.ceil((record.added + record.removed) / 2), untracked: false };
};

const header_of = async (run: Run, range: ChangeRange, unborn: boolean): Promise<string> => {
  if (range.kind === "branch") {
    const log = await run(["rev-list", "--no-commit-header", "--encoding=UTF-8", "--format=%s%n%n%b", `${range.base_ref}..HEAD`, "--"]);
    return `Commits of this branch:\n${git_ok(log, `git rev-list ${range.base_ref}..HEAD`).toString("utf8").trim()}\n\n`;
  }
  if (unborn) return "This is the first commit of the repository.\n\n";
  const log = await run(["rev-list", "--no-commit-header", "--encoding=UTF-8", "--format=%s", "--max-count=10", "HEAD", "--"]);
  const subjects = git_ok(log, "git rev-list HEAD").toString("utf8").trim();
  return subjects ? `Latest commit subjects:\n${subjects}\n\n` : "";
};

const list_changes = async (run: Run, dir: string, range: ChangeRange, unborn: boolean): Promise<(Candidate | string)[]> => {
  const base = range.kind === "working" ? "HEAD" : `${range.base_ref}...HEAD`;
  const records = unborn ? [] : parse_numstat(git_ok(await run(["diff", base, "--numstat", "-z", ...patch_flags, "--", "."]), `git diff ${base} --numstat`).toString("utf8"));
  const listed: (Candidate | string)[] = records.map(tracked_candidate);
  if (range.kind === "branch") return listed;
  const others = nul_list(await run(["ls-files", "-z", "--others", "--exclude-standard", ...(unborn ? ["--cached"] : []), "--", "."]), "git ls-files --others");
  for (const name of others) listed.push(await untracked_candidate(dir, name));
  return listed;
};

export const collect_change_text = async (access: GitReadAccess, range: ChangeRange, room: number): Promise<string> => {
  const dir = range.kind === "working" ? access.root : access.view.repo.root;
  const run: Run = (args, literal = false) => exec_git(access.tool, { cwd: dir, args, flags: no_index_refresh, config: access.config, literal_paths: literal, signal: access.signal });
  const unborn = range.kind === "working" && access.view.head === null;
  const base = range.kind === "working" ? "HEAD" : `${range.base_ref}...HEAD`;
  const [header, listed] = await Promise.all([header_of(run, range, unborn), list_changes(run, dir, range, unborn)]);
  const candidates = listed.filter((entry) => typeof entry !== "string");
  const notes = new Map<Candidate, string>();
  const blocks: string[] = [];
  const worst_list = listed.map((entry) => (typeof entry === "string" ? entry : `${entry.line}${size_note}`)).join("\n");
  let left = room - estimate_tokens(`${header}Changed files:\n${worst_list}\n\nDiff:\n`);
  const sorted = [...candidates].sort((a, b) => a.floor - b.floor);
  for (let from = 0; from < sorted.length; ) {
    const batch = next_batch(sorted, from, left);
    if (batch.length === 0) break;
    from += batch.length;
    const reads = await read_batch(run, dir, base, batch);
    const length = (read: Read | undefined): number => (read && "block" in read ? read.block.length : 0);
    const texts = batch.map((candidate) => ({ candidate, read: reads.get(candidate) })).sort((a, b) => length(a.read) - length(b.read));
    for (const { candidate, read } of texts) {
      if (!read) continue;
      if ("note" in read) {
        notes.set(candidate, read.note);
        continue;
      }
      const tokens = estimate_tokens(read.block);
      if (tokens > left) continue;
      blocks.push(read.block);
      notes.set(candidate, candidate.line);
      left -= tokens;
    }
  }
  const lines = listed.map((entry) => (typeof entry === "string" ? entry : (notes.get(entry) ?? `${entry.line}${size_note}`)));
  return `${header}Changed files:\n${lines.join("\n")}${blocks.length > 0 ? `\n\nDiff:\n${blocks.join("\n")}` : ""}`;
};
