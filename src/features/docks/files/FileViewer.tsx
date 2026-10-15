import { memo, useMemo } from "react";
import { max_view_bytes, type FileView } from "../../../../shared/ipc/files.ts";
import { IconButton } from "../../../components/Button.tsx";
import { file_language, highlightable } from "../../../components/code-language.ts";
import { FolderOpenIcon } from "../../../components/icons.tsx";
import { CopyButton } from "../../../components/MarkdownCopy.tsx";
import { SkeletonLines } from "../../../components/Skeleton.tsx";
import { use_highlight } from "../../../components/use-highlight.ts";
import { use_t } from "../../../i18n/index.ts";
import { close_file, files_store, reveal_file, select_file, shown_view, type FileTab } from "../../../state/files.ts";
import { base_name, line_count } from "../../../state/files-tree.ts";
import { use_store } from "../../../state/use-store.ts";
import { format_size } from "../../chat/media.ts";
import { DockEmpty } from "../DockPanel.tsx";
import { DockTabs } from "../DockTabs.tsx";

type TextView = Extract<FileView, { kind: "text" }>;

const highlight_limit = 200_000;

type PathBarProps = { path: string; meta: string };

const PathBar = ({ path, meta }: PathBarProps) => {
  const t = use_t();
  return (
    <div className="files-path">
      <span className="files-path-text">{path}</span>
      <span className="files-path-meta">{meta}</span>
      <CopyButton text={path} label={t("files.copy_path")} />
      <IconButton label={t("files.reveal")} size="sm" onClick={() => void reveal_file(path)}>
        <FolderOpenIcon size={14} />
      </IconButton>
    </div>
  );
};

type CodeViewProps = { path: string; text: string; lines: number };

const CodeView = memo(({ path, text, lines }: CodeViewProps) => {
  const language = file_language(path);
  const html = use_highlight(text, language, highlightable(language) && text.length <= highlight_limit);
  const numbers = useMemo(() => Array.from({ length: lines }, (_, index) => index + 1).join("\n"), [lines]);
  return (
    <div className="files-code" tabIndex={0}>
      <pre className="files-gutter" aria-hidden="true">
        {numbers}
      </pre>
      <pre className="files-text">{html === null ? <code>{text}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}</pre>
    </div>
  );
});

const TextBody = ({ view }: { view: TextView }) => {
  const t = use_t();
  const lines = line_count(view.text);
  const count = lines === 1 ? t("files.line") : t("files.lines", { n: lines });
  return (
    <>
      <PathBar path={view.path} meta={`${count}, ${format_size(view.size)}`} />
      {view.truncated && <p className="files-note">{t("files.truncated", { shown: format_size(max_view_bytes), size: format_size(view.size) })}</p>}
      <CodeView path={view.path} text={view.text} lines={lines} />
    </>
  );
};

const ViewerSkeleton = () => (
  <div className="files-viewer-skeleton" aria-busy="true">
    <SkeletonLines widths={[38, 64, 52, 80, 46, 72, 58, 34]} height={11} gap={9} />
  </div>
);

const FileBody = ({ tab }: { tab: FileTab }) => {
  const t = use_t();
  const view = tab.view;
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
  return <TextBody view={view} />;
};

export const FileViewer = () => {
  const t = use_t();
  const tabs = use_store(files_store, (state) => shown_view(state).tabs);
  const active = use_store(files_store, (state) => shown_view(state).active);
  const tab = tabs.find((entry) => entry.path === active) ?? null;
  const entries = useMemo(() => tabs.map((entry) => ({ id: entry.path, label: base_name(entry.path) })), [tabs]);

  return (
    <section className="files-viewer">
      <div className="files-bar">
        <DockTabs tabs={entries} active_id={active} label={t("files.tabs")} close_label={t("files.close_tab")} on_select={select_file} on_close={close_file} />
      </div>
      {tab && <FileBody key={tab.path} tab={tab} />}
    </section>
  );
};
