import type { GitView, GraphRow, HistoryPage, HistoryRequest, RefLabel } from "../../shared/git-view.ts";
import { empty_lanes, lay_out, type LaneState } from "../../shared/git/graph.ts";
import { path_key } from "../storage/paths.ts";
import type { GitReadAccess } from "./diff.ts";
import type { GitRef } from "./refs.ts";
import { stream_git, type GitLines } from "./run.ts";

export const history_page_size = 200;

const history_args = [
  "rev-list",
  "--topo-order",
  "--no-commit-header",
  "--encoding=UTF-8",
  "--format=%H%x00%P%x00%an%x00%at%x00%s",
  "--branches",
  "--remotes",
  "--tags",
  "HEAD",
  "--",
];

const kind_rank: Record<RefLabel["kind"], number> = { head: 0, branch: 2, remote: 3, tag: 4 };

type HistoryCommit = Omit<GraphRow, "col" | "color" | "up" | "down" | "width" | "labels">;

type Stream = { fingerprint: string; lines: GitLines; lanes: LaneState; produced: number; labels: Map<string, RefLabel[]>; shallow: boolean };

export type HistorySource = { view: () => GitView; access: () => Promise<GitReadAccess> };

export type GitHistory = {
  page: (source: HistorySource, request: HistoryRequest) => Promise<HistoryPage>;
  retire: (fingerprint: string | null) => void;
  close: () => void;
};

const max_date_seconds = 8_640_000_000_000;

export const commit_time = (seconds: string): number | null => (/^\d+$/.test(seconds) && Number(seconds) <= max_date_seconds ? Number(seconds) * 1000 : null);

export const parse_history_line = (line: string): HistoryCommit => {
  const [hash = "", parents = "", author = "", time = "", subject = ""] = line.split("\0");
  if (!/^[0-9a-f]{40,64}$/.test(hash)) {
    throw new Error(`git rev-list printed a line that is not a commit record: ${JSON.stringify(line.slice(0, 120))}`);
  }
  return { hash, parents: parents === "" ? [] : parents.split(" "), author, time: commit_time(time), subject };
};

const elsewhere = (ref: GitRef, top: string): string | null =>
  ref.kind === "branch" && ref.worktree !== null && path_key(ref.worktree) !== path_key(top) ? ref.worktree : null;

export const ref_labels = (refs: GitRef[], top: string): Map<string, RefLabel[]> => {
  const current = refs.find((ref) => ref.kind === "branch" && ref.head);
  const upstream = current?.upstream ?? null;
  const rank = (label: RefLabel) => (label.kind !== "head" && label.name === upstream ? 1 : kind_rank[label.kind]);
  const labels = new Map<string, RefLabel[]>();
  for (const ref of refs) {
    const label: RefLabel = { name: ref.name, kind: ref === current ? "head" : ref.kind, worktree: elsewhere(ref, top) };
    labels.set(ref.target, [...(labels.get(ref.target) ?? []), label]);
  }
  for (const [hash, list] of labels) {
    labels.set(hash, list.toSorted((left, right) => rank(left) - rank(right)));
  }
  return labels;
};

const open_stream = (access: GitReadAccess): Stream => ({
  fingerprint: access.view.fingerprint,
  lines: stream_git(access.tool, { cwd: access.root, args: history_args, config: access.config, signal: access.signal }, `git rev-list in ${access.root}`),
  lanes: empty_lanes,
  produced: 0,
  labels: ref_labels(access.refs, access.view.repo.root),
  shallow: access.view.repo.shallow,
});

const advance = async (stream: Stream, count: number) => {
  const batch = await stream.lines.read(count);
  const { rows, state } = lay_out(batch.lines.map(parse_history_line), stream.lanes);
  stream.lanes = state;
  stream.produced += rows.length;
  return { rows, done: batch.done };
};

export const create_history = (): GitHistory => {
  let stream: Stream | null = null;
  let queue: Promise<void> = Promise.resolve();

  const close = () => {
    stream?.lines.close();
    stream = null;
  };

  const start_stream = async (source: HistorySource, request: HistoryRequest): Promise<Stream> => {
    close();
    const access = await source.access();
    if (access.view.head === null) {
      throw new Error(`${access.view.repo.root} has no commits yet, so it has no history`);
    }
    const opened = open_stream(access);
    stream = opened;
    if (request.fingerprint === opened.fingerprint && request.offset > 0) {
      await advance(opened, request.offset);
    }
    return opened;
  };

  const continuing = (view: GitView, request: HistoryRequest): Stream | null => {
    if (!stream || view.kind !== "repo" || view.fingerprint !== stream.fingerprint) return null;
    return request.fingerprint === stream.fingerprint && request.offset === stream.produced ? stream : null;
  };

  const serve = async (source: HistorySource, request: HistoryRequest): Promise<HistoryPage> => {
    const current = continuing(source.view(), request) ?? (await start_stream(source, request));
    const start = current.produced;
    const { rows, done } = await advance(current, history_page_size);
    return {
      fingerprint: current.fingerprint,
      start,
      rows: rows.map((row) => ({ ...row, labels: current.labels.get(row.hash) ?? [] })),
      done,
      shallow_end: done && current.shallow,
    };
  };

  return {
    page: (source, request) => {
      const run = queue.then(() => serve(source, request));
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    retire: (fingerprint) => {
      if (stream && stream.fingerprint !== fingerprint) close();
    },
    close,
  };
};
