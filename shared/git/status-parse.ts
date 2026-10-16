import type { GitConflict, GitEntry, GitFileStatus, GitSubmoduleState } from "../git-view.ts";

export type StatusBranch = {
  oid: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  stash: number;
};

export type ParsedStatus = { branch: StatusBranch; entries: GitEntry[] };

const conflicts: readonly GitConflict[] = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

const split_fields = (record: string, count: number): string[] | null => {
  const fields: string[] = [];
  let at = 0;
  for (let index = 1; index < count; index += 1) {
    const space = record.indexOf(" ", at);
    if (space < 0) {
      return null;
    }
    fields.push(record.slice(at, space));
    at = space + 1;
  }
  fields.push(record.slice(at));
  return fields;
};

const submodule_of = (sub: string): GitSubmoduleState | null =>
  sub.startsWith("S") ? { commit: sub[1] === "C", tracked: sub[2] === "M", untracked: sub[3] === "U" } : null;

const tracked_status = (xy: string, renamed: boolean): GitFileStatus => {
  const x = xy[0];
  const y = xy[1];
  if (x === "D" || y === "D") return "deleted";
  if (renamed) return x === "C" || y === "C" ? "copied" : "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "T" || y === "T") return "type_changed";
  return "modified";
};

const tracked_entry = (xy: string, sub: string, path: string, orig_path: string | null, status: GitFileStatus, conflict: GitConflict | null): GitEntry => ({
  path,
  orig_path,
  status,
  staged: xy[0] !== ".",
  unstaged: xy[1] !== ".",
  conflict,
  submodule: submodule_of(sub),
  nested_repo: false,
});

const plain_entry = (path: string, status: GitFileStatus): GitEntry => ({
  path,
  orig_path: null,
  status,
  staged: false,
  unstaged: false,
  conflict: null,
  submodule: null,
  nested_repo: false,
});

const read_header = (branch: StatusBranch, header: string) => {
  const space = header.indexOf(" ");
  const key = space < 0 ? header : header.slice(0, space);
  const value = space < 0 ? "" : header.slice(space + 1);
  if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
  if (key === "branch.head") branch.head = value === "(detached)" ? null : value;
  if (key === "branch.upstream") branch.upstream = value;
  if (key === "stash") branch.stash = Number.parseInt(value, 10) || 0;
  if (key === "branch.ab") {
    const counts = /^\+(\d+) -(\d+)$/.exec(value);
    if (counts) {
      branch.ahead = Number(counts[1]);
      branch.behind = Number(counts[2]);
    }
  }
};

export const parse_status = (text: string): ParsedStatus => {
  const branch: StatusBranch = { oid: null, head: null, upstream: null, ahead: null, behind: null, stash: 0 };
  const entries: GitEntry[] = [];
  const records = text.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.startsWith("# ")) {
      read_header(branch, record.slice(2));
      continue;
    }
    if (record.startsWith("1 ")) {
      const fields = split_fields(record, 9);
      if (fields) entries.push(tracked_entry(fields[1] ?? "", fields[2] ?? "", fields[8] ?? "", null, tracked_status(fields[1] ?? "", false), null));
      continue;
    }
    if (record.startsWith("2 ")) {
      const fields = split_fields(record, 10);
      const orig_path = records[index + 1] ?? "";
      index += 1;
      if (fields) entries.push(tracked_entry(fields[1] ?? "", fields[2] ?? "", fields[9] ?? "", orig_path, tracked_status(fields[1] ?? "", true), null));
      continue;
    }
    if (record.startsWith("u ")) {
      const fields = split_fields(record, 11);
      if (!fields) continue;
      const xy = fields[1] ?? "";
      entries.push(tracked_entry(xy, fields[2] ?? "", fields[10] ?? "", null, "conflicted", conflicts.find((entry) => entry === xy) ?? null));
      continue;
    }
    if (record.startsWith("? ")) entries.push(plain_entry(record.slice(2), "untracked"));
    if (record.startsWith("! ")) entries.push(plain_entry(record.slice(2), "ignored"));
  }
  return { branch, entries };
};
