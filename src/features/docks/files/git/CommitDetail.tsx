import { useEffect, useMemo, useState, type ClipboardEvent, type ReactNode } from "react";
import type { CommitDetail, CommitFile, GitEntry } from "../../../../../shared/git-view.ts";
import { reflow_message } from "../../../../../shared/git/message.ts";
import { IconButton } from "../../../../components/Button.tsx";
import { CollapsibleBody } from "../../../../components/Collapsible.tsx";
import { ChevronRightIcon, ExternalLinkIcon } from "../../../../components/icons.tsx";
import { CopyButton } from "../../../../components/MarkdownCopy.tsx";
import { Skeleton, SkeletonLines } from "../../../../components/Skeleton.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_language, use_t, type Translate } from "../../../../i18n/index.ts";
import { open_external } from "../../../../state/chat-actions.ts";
import { files_store } from "../../../../state/files.ts";
import { base_name, parent_dir } from "../../../../state/files-tree.ts";
import { commit_diff_of, commit_of, git_history_store, load_commit, load_commit_diff } from "../../../../state/git-history.ts";
import { git_store, git_ui_of, toggle_commit_file } from "../../../../state/git.ts";
import { github_store, github_view_of } from "../../../../state/github.ts";
import { use_store } from "../../../../state/use-store.ts";
import { DiffRows } from "../../../tools/DiffView.tsx";
import { ChangeCounts } from "./ChangesList.tsx";
import { GitBadge } from "./GitBadge.tsx";
import { note_keys, ViewerNote } from "./ViewerDiff.tsx";
import "./CommitDetail.css";

const hash_mark = "\u0000";

const date_format: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };

const split_message = (message: string): { subject: string; body: string } => {
  const text = message.replace(/\r\n?/g, "\n");
  const gap = /\n[ \t]*\n/.exec(text);
  const head = gap ? text.slice(0, gap.index) : text;
  return { subject: head.replace(/\n/g, " ").trim(), body: gap ? text.slice(gap.index + gap[0].length).replace(/^\n+/, "") : "" };
};

const with_hash = (text: string, hash: string): ReactNode => {
  const [before = "", after = ""] = text.split(hash_mark);
  return (
    <span>
      {before}
      <code className="commit-detail-code">{hash}</code>
      {after}
    </span>
  );
};

const parent_part = (t: Translate, detail: CommitDetail): ReactNode => {
  const [first] = detail.parents;
  if (first === undefined) {
    return null;
  }
  const key = detail.parents.length > 1 ? "git.merge_parent" : "git.parent";
  return with_hash(t(key, { hash: hash_mark }), first.slice(0, 7));
};

const file_entry = (file: CommitFile): GitEntry => ({
  path: file.path,
  orig_path: file.orig_path,
  status: file.status,
  staged: false,
  unstaged: false,
  conflict: null,
  submodule: null,
  nested_repo: false,
});

type CommitFileDiffProps = { root: string; hash: string; path: string; scroller: HTMLElement | null };

const CommitFileDiff = ({ root, hash, path, scroller }: CommitFileDiffProps) => {
  const t = use_t();
  const readable = use_store(git_store, (state) => state.readable === root);
  const load = use_store(git_history_store, (state) => commit_diff_of(state, root, hash, path));
  useEffect(() => {
    if (readable && !load) void load_commit_diff(root, hash, path);
  }, [readable, root, hash, path, load]);
  if (!load || load.status === "loading") {
    return (
      <div className="commit-inline-diff commit-inline-skeleton" aria-busy="true">
        <SkeletonLines widths={[62, 48, 90, 40, 74, 56]} height={10} gap={10} />
      </div>
    );
  }
  if (!load.value) {
    return <ViewerNote text={t("git.diff_failed")} />;
  }
  if (load.value.kind !== "text") {
    return <ViewerNote text={t(note_keys[load.value.kind])} />;
  }
  return (
    <div className="commit-inline-diff">
      <DiffRows lines={load.value.lines} scroller={scroller} />
    </div>
  );
};

const CommitFileCounts = ({ file, counted }: { file: CommitFile; counted: boolean }) => {
  const t = use_t();
  if (!counted) {
    return null;
  }
  if (file.added === null || file.removed === null) {
    return <span className="git-binary">{t("git.binary")}</span>;
  }
  return <ChangeCounts added={file.added} removed={file.removed} />;
};

type CommitFileRowProps = { root: string; hash: string; file: CommitFile; counted: boolean; open: boolean; scroller: HTMLElement | null };

const CommitFileRow = ({ root, hash, file, counted, open, scroller }: CommitFileRowProps) => {
  const [shown, set_shown] = useState(open);
  if (open && !shown) {
    set_shown(true);
  }
  const place = file.orig_path === null ? parent_dir(file.path) : `← ${base_name(file.orig_path)}`;
  const title = file.orig_path === null ? file.path : `${file.orig_path} → ${file.path}`;
  return (
    <>
      <button type="button" className="git-change" data-git={file.status} aria-expanded={open} title={title} onClick={() => toggle_commit_file(hash, file.path)}>
        <ChevronRightIcon size={14} className="commit-file-chevron" />
        <GitBadge decoration={{ status: file.status, entry: file_entry(file), rollup: false }} dir={false} />
        <span className="git-change-name">{base_name(file.path)}</span>
        <span className="git-change-dir">{place}</span>
        <CommitFileCounts file={file} counted={counted} />
      </button>
      <CollapsibleBody open={open} on_closed={() => set_shown(false)}>
        {shown && <CommitFileDiff root={root} hash={hash} path={file.path} scroller={scroller} />}
      </CollapsibleBody>
    </>
  );
};

export const CommitDetailSkeleton = () => (
  <div className="commit-detail" aria-busy="true">
    <Skeleton width="58%" height={12} radius={4} className="commit-skeleton-title" />
    <Skeleton width="40%" height={10} radius={4} className="commit-skeleton-meta" />
    <SkeletonLines widths={[92, 86, 64]} height={10} gap={10} className="commit-skeleton-body" />
    <Skeleton width="24%" height={10} radius={4} className="commit-skeleton-label" />
    <Skeleton width="70%" height={10} radius={4} />
  </div>
);

type CommitDetailPaneProps = { root: string; hash: string; live: boolean };

export const CommitDetailPane = ({ root, hash, live }: CommitDetailPaneProps) => {
  const t = use_t();
  const language = use_language();
  const key = use_store(files_store, (state) => state.key);
  const open_file = use_store(git_store, (state) => git_ui_of(state, key).commit_file);
  const readable = use_store(git_store, (state) => state.readable === root);
  const load = use_store(git_history_store, (state) => commit_of(state, root, hash));
  const site = use_store(github_store, (state) => {
    const github = github_view_of(state, root);
    return github.kind === "data" ? github.html_url : null;
  });
  const [scroller, set_scroller] = useState<HTMLDivElement | null>(null);
  const detail = load?.value ?? null;
  const message = useMemo(() => (detail ? split_message(detail.message) : null), [detail]);
  const body = useMemo(() => (message ? reflow_message(message.body) : ""), [message]);

  useEffect(() => {
    if (live && readable && !load) void load_commit(root, hash);
  }, [live, readable, root, hash, load]);

  if (!load || (load.status === "loading" && !detail)) {
    return <CommitDetailSkeleton />;
  }
  if (!detail || !message) {
    return (
      <div className="commit-detail">
        <ViewerNote text={t("git.commit_failed")} />
      </div>
    );
  }
  const copy_original = (event: ClipboardEvent<HTMLDivElement>) => {
    if (window.getSelection()?.toString() !== body) return;
    event.clipboardData.setData("text/plain", message.body);
    event.preventDefault();
  };
  const date = detail.time === null ? null : new Intl.DateTimeFormat(language, date_format).format(new Date(detail.time));
  const parent = parent_part(t, detail);
  const opened = open_file?.hash === detail.hash ? open_file.path : null;
  return (
    <div className="commit-detail" ref={set_scroller}>
      <div className="commit-detail-head">
        <div className="commit-detail-title">{message.subject}</div>
        {site !== null && (
          <IconButton size="sm" label={t("github.open")} onClick={() => open_external(`${site}/commit/${detail.hash}`)}>
            <ExternalLinkIcon size={14} />
          </IconButton>
        )}
      </div>
      <div className="commit-detail-meta">
        <Tooltip label={detail.email} placement="bottom-start">
          <span className="commit-detail-author" tabIndex={0}>
            {detail.author}
          </span>
        </Tooltip>
        {date !== null && (
          <>
            <span className="git-sep">·</span>
            <span>{date}</span>
          </>
        )}
        <span className="git-sep">·</span>
        <span className="commit-detail-hash">
          <code className="commit-detail-code">{detail.hash.slice(0, 7)}</code>
          <CopyButton text={detail.hash} label={t("git.copy_hash")} />
        </span>
        {parent && <span className="git-sep">·</span>}
        {parent}
      </div>
      {body && (
        <div className="commit-detail-body" onCopy={copy_original}>
          {body}
        </div>
      )}
      {detail.files.length > 0 && (
        <div className="commit-detail-files">
          <div className="commit-detail-label">
            <span className="section-label">{t("git.commit_files")}</span>
            <span className="git-group-count">{detail.files.length}</span>
          </div>
          {detail.files.map((file) => (
            <CommitFileRow key={file.path} root={root} hash={detail.hash} file={file} counted={detail.counted} open={opened === file.path} scroller={scroller} />
          ))}
        </div>
      )}
    </div>
  );
};
