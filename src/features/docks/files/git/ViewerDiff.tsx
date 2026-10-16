import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { GitEntry, GitFileDiff, GitRepoView, GitView } from "../../../../../shared/git-view.ts";
import { diff_bars, diff_totals } from "../../../../../shared/git/diff-parse.ts";
import { CircleAlertIcon, FileDiffIcon, FileIcon, InfoIcon } from "../../../../components/icons.tsx";
import { Segmented } from "../../../../components/Segmented.tsx";
import { use_t, type MessageKey } from "../../../../i18n/index.ts";
import { files_store } from "../../../../state/files.ts";
import { diff_of, git_diff_store, load_diff, type GitLoad } from "../../../../state/git-diff.ts";
import { git_store, git_ui_of, set_viewer_mode, shown_root, type ViewerMode } from "../../../../state/git.ts";
import { use_store } from "../../../../state/use-store.ts";
import { DiffRows } from "../../../tools/DiffView.tsx";
import { ChangeCounts } from "./ChangesList.tsx";
import { use_shown_git } from "./use-shown-git.ts";
import "./ViewerDiff.css";

export type TabGit = { entry: GitEntry; mode: ViewerMode; toggle: boolean; bars: boolean; load: GitLoad<GitFileDiff> | null };

type TabFacts = { entry: GitEntry; diffable: boolean; toggle: boolean; bars: boolean };

const toggled = new Set<GitEntry["status"]>(["modified", "renamed", "copied", "type_changed"]);

const untracked_statuses = new Set<GitEntry["status"]>(["untracked", "ignored"]);

export const note_keys: Record<Exclude<GitFileDiff["kind"], "text">, MessageKey> = {
  binary: "git.viewer_binary",
  eol_only: "git.viewer_eol",
  conflict: "git.conflict",
  object_missing: "git.viewer_object_missing",
  unchanged: "git.viewer_unchanged",
};

const conflict_marker = /^(?:<{7}|={7}|>{7})(?:\s|$)/;

const kept_on_disk = (view: GitRepoView, key: string): boolean =>
  view.entries.some((entry) => {
    if (!untracked_statuses.has(entry.status)) return false;
    const other = entry.path.toLowerCase();
    return other === key || (other.endsWith("/") && key.startsWith(other));
  });

const tab_facts = (view: GitView, path: string | null): TabFacts | null => {
  if (view.kind !== "repo" || path === null) {
    return null;
  }
  const key = path.toLowerCase();
  const entry = view.entries.find((candidate) => candidate.path.toLowerCase() === key && !untracked_statuses.has(candidate.status));
  if (!entry || entry.submodule !== null) {
    return null;
  }
  const diffable = view.head !== null && entry.status !== "conflicted";
  const deleted = entry.status === "deleted";
  const switchable = toggled.has(entry.status) || (deleted && kept_on_disk(view, key));
  return { entry, diffable, toggle: diffable && switchable, bars: !deleted };
};

const tab_mode = (facts: TabFacts, stored: ViewerMode): ViewerMode => {
  if (facts.toggle) {
    return stored;
  }
  return facts.diffable && facts.entry.status === "deleted" ? "diff" : "file";
};

const use_file_diff = (path: string | null, live: boolean): GitLoad<GitFileDiff> | null => {
  const root = use_store(files_store, shown_root);
  const readable = use_store(git_store, (state) => root !== null && state.readable === root);
  const load = use_store(git_diff_store, (state) => (root === null || path === null ? null : diff_of(state, root, path)));
  useEffect(() => {
    if (live && readable && root !== null && path !== null && (!load || !load.fresh)) {
      void load_diff(root, path);
    }
  }, [live, readable, root, path, load]);
  return load;
};

export const use_tab_git = (path: string | null, live: boolean): TabGit | null => {
  const view = use_shown_git();
  const key = use_store(files_store, (state) => state.key);
  const stored = use_store(git_store, (state) => (path === null ? "file" : (git_ui_of(state, key).modes[path] ?? "file")));
  const facts = useMemo(() => tab_facts(view, path), [view, path]);
  const load = use_file_diff(facts?.diffable ? facts.entry.path : null, live);
  return facts ? { entry: facts.entry, mode: tab_mode(facts, stored), toggle: facts.toggle, bars: facts.bars, load } : null;
};

type ViewerNoteProps = { text: string; tone?: "conflict" };

export const ViewerNote = ({ text, tone }: ViewerNoteProps) => (
  <p className="files-note" data-tone={tone}>
    <span className="files-note-icon">{tone === "conflict" ? <CircleAlertIcon size={14} /> : <InfoIcon size={14} />}</span>
    <span>{text}</span>
  </p>
);

type ModeSwitchProps = { path: string; mode: ViewerMode; narrow: boolean };

export const ViewerModeSwitch = ({ path, mode, narrow }: ModeSwitchProps) => {
  const t = use_t();
  return (
    <Segmented
      className="git-mode"
      size="sm"
      fit
      tooltips={narrow}
      label={t("git.viewer_mode")}
      value={mode}
      on_change={(next) => set_viewer_mode(path, next)}
      options={[
        { id: "file", label: t("git.mode_file"), icon: <FileIcon size={16} /> },
        { id: "diff", label: t("git.mode_diff"), icon: <FileDiffIcon size={16} /> },
      ]}
    />
  );
};

export const diff_meta = (load: GitLoad<GitFileDiff> | null): ReactNode => {
  if (load?.value?.kind !== "text") {
    return null;
  }
  const { added, removed } = diff_totals(load.value.lines);
  return <ChangeCounts added={added} removed={removed} />;
};

const DiffScroll = ({ lines }: { lines: Extract<GitFileDiff, { kind: "text" }>["lines"] }) => {
  const [scroller, set_scroller] = useState<HTMLDivElement | null>(null);
  return (
    <div className="git-diff" ref={set_scroller} tabIndex={0}>
      <DiffRows lines={lines} scroller={scroller} />
    </div>
  );
};

export const DiffBody = ({ diff }: { diff: GitFileDiff }) => {
  const t = use_t();
  return diff.kind === "text" ? <DiffScroll lines={diff.lines} /> : <ViewerNote text={t(note_keys[diff.kind])} />;
};

export const ChangeBars = ({ load, lines }: { load: GitLoad<GitFileDiff> | null; lines: number }) => {
  const bars = useMemo(() => (load?.value?.kind === "text" ? diff_bars(load.value.lines) : []), [load?.value]);
  return bars
    .filter((bar) => bar.line <= lines + 1)
    .map((bar) => (
      <span
        key={`${bar.kind}:${bar.line}`}
        className="files-change-bar"
        data-bar={bar.kind}
        style={{ "--bar-line": bar.line - 1, "--bar-span": Math.min(bar.count, lines + 1 - bar.line) } as CSSProperties}
      />
    ));
};

export const conflict_text = (text: string): ReactNode[] => {
  const parts: ReactNode[] = [];
  let plain = "";
  for (const [index, line] of text.split("\n").entries()) {
    const lead = index === 0 ? "" : "\n";
    if (!conflict_marker.test(line)) {
      plain += lead + line;
      continue;
    }
    parts.push(plain + lead, <span key={index} className="conflict-marker">{line}</span>);
    plain = "";
  }
  parts.push(plain);
  return parts;
};
