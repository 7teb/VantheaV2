import { memo, useMemo, type ReactNode } from "react";
import type { GitFileDiff } from "../../../../shared/git-view.ts";
import { max_view_bytes, type FileView } from "../../../../shared/ipc/files.ts";
import { IconButton } from "../../../components/Button.tsx";
import { file_language, highlightable } from "../../../components/code-language.ts";
import { FolderOpenIcon } from "../../../components/icons.tsx";
import { CopyButton } from "../../../components/MarkdownCopy.tsx";
import { SkeletonLines } from "../../../components/Skeleton.tsx";
import { use_highlight } from "../../../components/use-highlight.ts";
import { use_t, type Translate } from "../../../i18n/index.ts";
import { close_file, files_store, reveal_file, select_file, shown_view, type FileTab } from "../../../state/files.ts";
import { base_name, line_count } from "../../../state/files-tree.ts";
import type { GitLoad } from "../../../state/git-diff.ts";
import { use_store } from "../../../state/use-store.ts";
import { format_size } from "../../chat/media.ts";
import { DockEmpty } from "../DockPanel.tsx";
import { DockTabs } from "../DockTabs.tsx";
import { conflict_title } from "./git/GitBadge.tsx";
import { ChangeBars, conflict_text, diff_meta, DiffBody, use_tab_git, ViewerModeSwitch, ViewerNote, type TabGit } from "./git/ViewerDiff.tsx";

type TextView = Extract<FileView, { kind: "text" }>;

type DiffLoad = GitLoad<GitFileDiff> | null;

const highlight_limit = 200_000;

type PathBarProps = { path: string; meta: ReactNode; on_disk?: boolean };

const PathBar = ({ path, meta, on_disk = true }: PathBarProps) => {
  const t = use_t();
  return (
    <div className="files-path">
      <span className="files-path-text">{path}</span>
      <span className="files-path-meta">{meta}</span>
      <CopyButton text={path} label={t("files.copy_path")} />
      {on_disk && (
        <IconButton label={t("files.reveal")} size="sm" onClick={() => void reveal_file(path)}>
          <FolderOpenIcon size={14} />
        </IconButton>
      )}
    </div>
  );
};

type CodeViewProps = { path: string; text: string; lines: number; diff: DiffLoad; conflict: boolean };

const CodeView = memo(({ path, text, lines, diff, conflict }: CodeViewProps) => {
  const language = file_language(path);
  const html = use_highlight(text, language, !conflict && highlightable(language) && text.length <= highlight_limit);
  const numbers = useMemo(() => Array.from({ length: lines }, (_, index) => index + 1).join("\n"), [lines]);
  const marked = useMemo(() => (conflict ? conflict_text(text) : null), [conflict, text]);
  const code = () => {
    if (marked) {
      return <code>{marked}</code>;
    }
    return html === null ? <code>{text}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />;
  };
  return (
    <div className="files-code" tabIndex={0}>
      <pre className="files-gutter" aria-hidden="true">
        {numbers}
        <ChangeBars load={diff} lines={lines} />
      </pre>
      <pre className="files-text">{code()}</pre>
    </div>
  );
});

const text_meta = (t: Translate, view: TextView): string => {
  const lines = line_count(view.text);
  return `${lines === 1 ? t("files.line") : t("files.lines", { n: lines })}, ${format_size(view.size)}`;
};

const TextBody = ({ view, git }: { view: TextView; git: TabGit | null }) => {
  const t = use_t();
  const conflict = git?.entry.status === "conflicted";
  return (
    <>
      <PathBar path={view.path} meta={text_meta(t, view)} />
      {view.truncated && <ViewerNote text={t("files.truncated", { shown: format_size(max_view_bytes), size: format_size(view.size) })} />}
      {conflict && <ViewerNote tone="conflict" text={conflict_title(t, git.entry.conflict)} />}
      <CodeView path={view.path} text={view.text} lines={line_count(view.text)} diff={git?.bars ? git.load : null} conflict={conflict} />
    </>
  );
};

const ViewerSkeleton = () => (
  <div className="files-viewer-skeleton" aria-busy="true">
    <SkeletonLines widths={[38, 64, 52, 80, 46, 72, 58, 34]} height={11} gap={9} />
  </div>
);

const diff_content = (t: Translate, load: DiffLoad) => {
  if (load?.value) {
    return <DiffBody diff={load.value} />;
  }
  return load?.status === "failed" ? <DockEmpty text={t("git.diff_failed")} /> : <ViewerSkeleton />;
};

const DiffMode = ({ tab, load }: { tab: FileTab; load: DiffLoad }) => {
  const t = use_t();
  const file_meta = tab.view?.kind === "text" ? text_meta(t, tab.view) : null;
  return (
    <>
      <PathBar path={tab.path} meta={diff_meta(load) ?? file_meta} on_disk={tab.view?.kind !== "missing"} />
      {diff_content(t, load)}
    </>
  );
};

const FileBody = ({ tab, git }: { tab: FileTab; git: TabGit | null }) => {
  const t = use_t();
  const view = tab.view;
  if (git?.mode === "diff") {
    return <DiffMode tab={tab} load={git.load} />;
  }
  if (tab.status === "failed") {
    return <DockEmpty text={t("files.read_failed")} />;
  }
  if (view === null) {
    return <ViewerSkeleton />;
  }
  if (view.kind === "missing") {
    return <DockEmpty text={t("files.missing")} />;
  }
  if (view.kind === "binary") {
    return (
      <>
        <PathBar path={view.path} meta={format_size(view.size)} />
        <DockEmpty text={t("files.binary", { size: format_size(view.size) })} />
      </>
    );
  }
  return <TextBody view={view} git={git} />;
};

type FileViewerProps = { live: boolean; narrow: boolean };

export const FileViewer = ({ live, narrow }: FileViewerProps) => {
  const t = use_t();
  const tabs = use_store(files_store, (state) => shown_view(state).tabs);
  const active = use_store(files_store, (state) => shown_view(state).active);
  const tab = tabs.find((entry) => entry.path === active) ?? null;
  const entries = useMemo(() => tabs.map((entry) => ({ id: entry.path, label: base_name(entry.path) })), [tabs]);
  const git = use_tab_git(tab?.path ?? null, live);

  return (
    <section className="files-viewer">
      <div className="files-bar">
        <DockTabs tabs={entries} active_id={active} label={t("files.tabs")} close_label={t("files.close_tab")} on_select={select_file} on_close={close_file} />
        {tab && git?.toggle && <ViewerModeSwitch path={tab.path} mode={git.mode} narrow={narrow} />}
      </div>
      {tab && <FileBody key={tab.path} tab={tab} git={git} />}
    </section>
  );
};
