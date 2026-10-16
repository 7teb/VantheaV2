import { useEffect, useMemo, useState } from "react";
import type { GitEntry, LineCount } from "../../../../../shared/git-view.ts";
import { FolderGitIcon } from "../../../../components/icons.tsx";
import { Skeleton } from "../../../../components/Skeleton.tsx";
import { VirtualRows } from "../../../../components/VirtualRows.tsx";
import { use_t, type MessageKey } from "../../../../i18n/index.ts";
import { files_store, shown_view } from "../../../../state/files.ts";
import { base_name, parent_dir } from "../../../../state/files-tree.ts";
import { counts_of, git_diff_store, load_counts } from "../../../../state/git-diff.ts";
import { changed_entries, git_store, shown_root, type ViewerMode } from "../../../../state/git.ts";
import { use_store } from "../../../../state/use-store.ts";
import { GitBadge } from "./GitBadge.tsx";
import { use_shown_git } from "./use-shown-git.ts";
import "./ChangesList.css";

type ListRow = { kind: "label"; label: MessageKey; count: number } | { kind: "entry"; entry: GitEntry };

const row_height = 26;

const skeleton_widths = [44, 58, 36, 66, 50, 40, 62];

const by_path = (left: GitEntry, right: GitEntry) => left.path.toLowerCase().localeCompare(right.path.toLowerCase());

const list_rows = (entries: GitEntry[]): ListRow[] => {
  const groups: { label: MessageKey; items: GitEntry[] }[] = [
    { label: "git.group_conflicts", items: entries.filter((entry) => entry.status === "conflicted") },
    { label: "git.group_changed", items: entries.filter((entry) => entry.status !== "conflicted" && entry.status !== "untracked") },
    { label: "git.group_untracked", items: entries.filter((entry) => entry.status === "untracked") },
  ];
  const filled = groups.filter((group) => group.items.length > 0);
  return filled.flatMap((group): ListRow[] => [
    ...(filled.length > 1 ? [{ kind: "label" as const, label: group.label, count: group.items.length }] : []),
    ...[...group.items].sort(by_path).map((entry) => ({ kind: "entry" as const, entry })),
  ]);
};

const is_folder = (entry: GitEntry) => entry.path.endsWith("/") || entry.submodule !== null;

const counted = (entry: GitEntry) => entry.status !== "untracked" && entry.status !== "conflicted";

const use_line_counts = (live: boolean): Map<string, LineCount> | null => {
  const root = use_store(files_store, shown_root);
  const readable = use_store(git_store, (state) => root !== null && state.readable === root);
  const load = use_store(git_diff_store, (state) => (root === null ? null : counts_of(state, root)));
  useEffect(() => {
    if (live && readable && root !== null && (!load || !load.fresh)) {
      void load_counts(root);
    }
  }, [live, readable, root, load]);
  return useMemo(() => {
    if (load?.value) {
      return new Map(load.value.map((count) => [count.path, count]));
    }
    return load?.status === "failed" ? new Map<string, LineCount>() : null;
  }, [load?.value, load?.status]);
};

export const ChangeCounts = ({ added, removed }: { added: number; removed: number }) => (
  <span className="git-counts">
    {added > 0 && <span className="git-add">+{added}</span>}
    {removed > 0 && <span className="git-del">-{removed}</span>}
  </span>
);

const RowCounts = ({ entry, counts }: { entry: GitEntry; counts: Map<string, LineCount> | null }) => {
  const t = use_t();
  if (!counted(entry)) {
    return null;
  }
  if (counts === null) {
    return (
      <span className="git-counts">
        <Skeleton width={34} height={10} radius={4} />
      </span>
    );
  }
  const count = counts.get(entry.path);
  if (!count) {
    return null;
  }
  if (count.added === null || count.removed === null) {
    return (
      <span className="git-counts">
        <span className="git-binary">{t("git.binary")}</span>
      </span>
    );
  }
  return <ChangeCounts added={count.added} removed={count.removed} />;
};

type OpenEntry = (path: string, mode: ViewerMode) => void;

type ChangeRowProps = { entry: GitEntry; active: boolean; counts: Map<string, LineCount> | null; on_open: OpenEntry };

const ChangeRow = ({ entry, active, counts, on_open }: ChangeRowProps) => {
  const trimmed = entry.path.replace(/\/$/, "");
  const name = entry.path.endsWith("/") ? `${base_name(trimmed)}/` : base_name(trimmed);
  const place = entry.orig_path === null ? parent_dir(trimmed) : `← ${base_name(entry.orig_path)}`;
  const title = entry.orig_path === null ? entry.path : `${entry.orig_path} → ${entry.path}`;
  const content = (
    <>
      {entry.nested_repo ? (
        <span className="git-change-mark">
          <FolderGitIcon size={14} />
        </span>
      ) : (
        <GitBadge decoration={{ status: entry.status, entry, rollup: false }} dir={false} />
      )}
      <span className="git-change-name">{name}</span>
      <span className="git-change-dir">{place}</span>
      <RowCounts entry={entry} counts={counts} />
    </>
  );
  if (is_folder(entry)) {
    return (
      <div className="git-change" data-git={entry.status} title={title}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" className="git-change" data-git={entry.status} data-active={active} title={title} onClick={() => on_open(entry.path, entry.status === "untracked" ? "file" : "diff")}>
      {content}
    </button>
  );
};

const ChangesSkeleton = () => (
  <div className="git-list" aria-busy="true">
    {skeleton_widths.map((width, index) => (
      <div key={index} className="git-change-skeleton">
        <Skeleton width={16} height={16} radius={4} />
        <Skeleton width={`${width}%`} height={10} radius={4} />
      </div>
    ))}
  </div>
);

type ChangesListProps = { live: boolean; on_open: OpenEntry };

export const ChangesList = ({ live, on_open }: ChangesListProps) => {
  const t = use_t();
  const view = use_shown_git();
  const active = use_store(files_store, (state) => shown_view(state).active);
  const rows = useMemo(() => list_rows(changed_entries(view)), [view]);
  const counts = use_line_counts(live && view.kind === "repo");
  const [scroller, set_scroller] = useState<HTMLDivElement | null>(null);

  if (view.kind !== "repo") {
    return (
      <div className="files-tree">
        <ChangesSkeleton />
      </div>
    );
  }
  return (
    <div className="files-tree">
      <div className="git-list" ref={set_scroller}>
        <VirtualRows
          items={rows}
          row_height={row_height}
          scroller={scroller}
          render={(row) =>
            row.kind === "label" ? (
              <div key={`label:${row.label}`} className="git-group-label">
                <span className="section-label">{t(row.label)}</span>
                <span className="git-group-count">{row.count}</span>
              </div>
            ) : (
              <ChangeRow key={`${row.entry.status}:${row.entry.path}`} entry={row.entry} active={row.entry.path === active} counts={counts} on_open={on_open} />
            )
          }
        />
      </div>
    </div>
  );
};
