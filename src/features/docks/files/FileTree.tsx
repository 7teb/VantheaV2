import { useMemo, type CSSProperties } from "react";
import type { DirEntry } from "../../../../shared/ipc/files.ts";
import { IconButton } from "../../../components/Button.tsx";
import { ChevronRightIcon, CloseIcon, FileIcon, FolderIcon, FolderOpenIcon, SearchIcon } from "../../../components/icons.tsx";
import { Skeleton, SkeletonRows } from "../../../components/Skeleton.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { use_t } from "../../../i18n/index.ts";
import { files_store, open_file, set_query, shown_view, toggle_dir } from "../../../state/files.ts";
import { base_name, parent_dir, tree_rows, type TreeRow } from "../../../state/files-tree.ts";
import { use_store } from "../../../state/use-store.ts";

const indent = (depth: number) => ({ "--depth": depth }) as CSSProperties;

const entry_icon = (entry: DirEntry, open: boolean) => {
  if (entry.kind === "file") {
    return <FileIcon size={15} />;
  }
  return open ? <FolderOpenIcon size={15} /> : <FolderIcon size={15} />;
};

type EntryRowProps = { entry: DirEntry; depth: number; open: boolean; active: boolean };

const EntryRow = ({ entry, depth, open, active }: EntryRowProps) => {
  const activate = () => {
    if (entry.kind === "dir") {
      toggle_dir(entry.path);
      return;
    }
    void open_file(entry.path);
  };
  return (
    <button
      type="button"
      className="files-row"
      style={indent(depth)}
      data-active={active}
      aria-expanded={entry.kind === "dir" ? open : undefined}
      title={entry.path}
      onClick={activate}
    >
      <span className="files-row-chevron" data-open={open}>
        {entry.kind === "dir" && <ChevronRightIcon size={13} />}
      </span>
      <span className="files-row-icon">{entry_icon(entry, open)}</span>
      <span className="files-row-label">{entry.name}</span>
    </button>
  );
};

type NoteRowProps = { row: Exclude<TreeRow, { kind: "entry" }> };

const NoteRow = ({ row }: NoteRowProps) => {
  const t = use_t();
  if (row.kind === "loading") {
    return (
      <div className="files-note-row" style={indent(row.depth)} aria-busy="true">
        <Skeleton width="42%" height={10} radius={4} />
      </div>
    );
  }
  return (
    <div className="files-note-row" style={indent(row.depth)}>
      {row.kind === "more" ? t("files.more", { n: row.count }) : t("files.folder_failed")}
    </div>
  );
};

const RowsSkeleton = () => <SkeletonRows widths={[58, 44, 66, 50, 38, 62]} row_height={26} icon className="files-rows-skeleton" />;

const TreeRows = ({ active }: { active: string | null }) => {
  const dirs = use_store(files_store, (state) => shown_view(state).dirs);
  const expanded = use_store(files_store, (state) => shown_view(state).expanded);
  const rows = useMemo(() => tree_rows(dirs, expanded), [dirs, expanded]);
  const top = dirs[""];
  if (!top || top.status === "loading") {
    return <RowsSkeleton />;
  }
  return rows.map((row) =>
    row.kind === "entry" ? (
      <EntryRow key={row.entry.path} entry={row.entry} depth={row.depth} open={row.open} active={row.entry.path === active} />
    ) : (
      <NoteRow key={`${row.kind}:${row.path}`} row={row} />
    ),
  );
};

const MatchRows = ({ active }: { active: string | null }) => {
  const t = use_t();
  const matches = use_store(files_store, (state) => shown_view(state).matches);
  if (matches.status === "failed") {
    return <p className="files-tree-note">{t("files.find_failed")}</p>;
  }
  if (matches.query === "") {
    return <RowsSkeleton />;
  }
  if (matches.paths.length === 0) {
    return <p className="files-tree-note">{t("files.no_matches")}</p>;
  }
  return (
    <>
      {matches.paths.map((path) => (
        <button key={path} type="button" className="files-row files-match" data-active={path === active} title={path} onClick={() => void open_file(path)}>
          <span className="files-row-icon">
            <FileIcon size={15} />
          </span>
          <span className="files-match-name">{base_name(path)}</span>
          <span className="files-match-dir">{parent_dir(path)}</span>
        </button>
      ))}
      {matches.truncated && <p className="files-tree-note">{t("files.matches_capped")}</p>}
    </>
  );
};

export const FileTree = () => {
  const t = use_t();
  const query = use_store(files_store, (state) => shown_view(state).query);
  const active = use_store(files_store, (state) => shown_view(state).active);
  const filtering = query.trim() !== "";

  return (
    <div className="files-tree">
      <div className="files-bar">
        <TextField
          className="files-filter"
          value={query}
          on_change={set_query}
          placeholder={t("files.filter")}
          aria-label={t("files.filter")}
          icon={<SearchIcon size={14} />}
          trailing={
            query && (
              <IconButton label={t("files.clear_filter")} size="sm" tooltip={false} className="files-filter-clear" onClick={() => set_query("")}>
                <CloseIcon size={12} />
              </IconButton>
            )
          }
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              set_query("");
            }
          }}
        />
      </div>
      <div className="files-tree-scroll">{filtering ? <MatchRows active={active} /> : <TreeRows active={active} />}</div>
    </div>
  );
};
