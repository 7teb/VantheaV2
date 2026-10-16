import { useCallback, useEffect, useRef, useState } from "react";
import type { GitView } from "../../../../shared/git-view.ts";
import { IconButton } from "../../../components/Button.tsx";
import { ExpandIcon, PanelLeftIcon, RetryIcon, ShrinkIcon } from "../../../components/icons.tsx";
import { SkeletonRows } from "../../../components/Skeleton.tsx";
import { use_t, type Translate } from "../../../i18n/index.ts";
import { files_store, open_file, set_tree_open, shown_view, sync_files, toggle_tree, unwatch_files, watch_files } from "../../../state/files.ts";
import { reload_git_diffs } from "../../../state/git-diff.ts";
import { reload_git_history } from "../../../state/git-history.ts";
import { changed_entries, drop_git_session, git_store, git_ui_of, refresh_git, set_surface, set_viewer_mode, type GitSurface, type ViewerMode } from "../../../state/git.ts";
import { toggle_dock_expanded, ui_store } from "../../../state/ui.ts";
import { use_store } from "../../../state/use-store.ts";
import type { DockViewProps } from "../dock-view.ts";
import { DockEmpty, DockPanel, DockTitle } from "../DockPanel.tsx";
import { FileTree } from "./FileTree.tsx";
import { FileViewer } from "./FileViewer.tsx";
import { ChangesList } from "./git/ChangesList.tsx";
import { GitCard } from "./git/GitCard.tsx";
import { HistoryView } from "./git/HistoryView.tsx";
import { SurfaceSwitch } from "./git/SurfaceSwitch.tsx";
import { use_shown_git } from "./git/use-shown-git.ts";
import "./FilesDock.css";

const narrow_below = 420;

const refresh = () => {
  refresh_git();
  reload_git_diffs();
  reload_git_history();
  void sync_files();
};

const surface_of = (stored: GitSurface, git: GitView, changes: number): GitSurface => {
  if (stored === "changes" && (git.kind === "loading" || changes > 0)) {
    return "changes";
  }
  if (stored === "history" && (git.kind === "loading" || (git.kind === "repo" && git.head !== null))) {
    return "history";
  }
  return "files";
};

const column_label = (t: Translate, surface: GitSurface, open: boolean): string => {
  if (surface === "changes") {
    return open ? t("git.hide_list") : t("git.show_list");
  }
  return open ? t("files.hide_tree") : t("files.show_tree");
};

const use_narrow = (): [boolean, (node: HTMLDivElement | null) => (() => void) | undefined] => {
  const [narrow, set_narrow] = useState(false);
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return undefined;
    }
    const observer = new ResizeObserver(() => set_narrow(node.clientWidth < narrow_below));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [narrow, measure];
};

export const FilesDock = ({ visible, chat_id, project_path }: DockViewProps) => {
  const t = use_t();
  const key = use_store(files_store, (state) => state.key);
  const root = use_store(files_store, (state) => shown_view(state).root);
  const has_tabs = use_store(files_store, (state) => shown_view(state).tabs.length > 0);
  const tree_open = use_store(files_store, (state) => shown_view(state).tree_open);
  const active = use_store(files_store, (state) => shown_view(state).active);
  const expanded = use_store(ui_store, (state) => state.dock.expanded);
  const stored_surface = use_store(git_store, (state) => git_ui_of(state, key).surface);
  const git = use_shown_git();
  const [narrow, measure] = use_narrow();
  const opened = useRef({ key, active });
  const fetching = git.kind === "repo" && git.fetch.running;
  const changes = changed_entries(git).length;
  const has_history = git.kind === "repo" && git.head !== null;
  const surface = surface_of(stored_surface, git, changes);

  useEffect(() => {
    if (!visible) {
      return;
    }
    return () => {
      unwatch_files();
      drop_git_session();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    void sync_files();
    watch_files();
  }, [visible, chat_id, project_path]);

  useEffect(() => {
    if (git.kind === "repo" && ((stored_surface === "changes" && changes === 0) || (stored_surface === "history" && !has_history))) {
      set_surface("files");
    }
  }, [stored_surface, git.kind, changes, has_history]);

  useEffect(() => {
    const before = opened.current;
    opened.current = { key, active };
    if (narrow && before.key === key && active !== null && active !== before.active) {
      set_tree_open(false);
    }
  }, [key, active, narrow]);

  const open_entry = (path: string, mode: ViewerMode) => {
    set_viewer_mode(path, mode);
    void open_file(path);
    if (narrow) {
      set_tree_open(false);
    }
  };

  const body = () => {
    if (root.status === "none") {
      return <DockEmpty text={t("files.no_folder")} />;
    }
    if (root.status === "failed") {
      return <DockEmpty text={t("files.root_failed")} />;
    }
    if (root.root === null) {
      return (
        <div className="files-skeleton" aria-busy="true">
          <SkeletonRows widths={[46, 62, 38, 70, 54, 42, 58]} row_height={26} icon />
        </div>
      );
    }
    if (surface === "history") {
      return <HistoryView live={visible} measure={measure} />;
    }
    return (
      <div className="files-split" ref={measure} data-surface={surface} data-tree={tree_open || !has_tabs} data-viewer={has_tabs}>
        {surface === "changes" ? <ChangesList live={visible} on_open={open_entry} /> : <FileTree on_open={(path) => open_entry(path, "file")} />}
        {has_tabs && <FileViewer live={visible} narrow={narrow} />}
      </div>
    );
  };

  const name = root.root?.kind === "workspace" ? t("files.workspace") : root.root?.name;

  return (
    <DockPanel
      title={git.kind === "repo" ? <SurfaceSwitch surface={surface} changes={changes} history={has_history} meta={name} narrow={narrow} /> : <DockTitle label={t("files.title")} meta={name} />}
      close_label={t("files.close")}
      toolbar={<GitCard />}
      actions={
        <>
          {git.kind !== "none" && (
            <IconButton label={fetching ? t("git.fetching") : t("git.refresh")} onClick={refresh}>
              <RetryIcon size={16} className={fetching ? "spin" : undefined} />
            </IconButton>
          )}
          {has_tabs && surface !== "history" && (
            <IconButton label={column_label(t, surface, tree_open)} aria-pressed={!tree_open} onClick={toggle_tree}>
              <PanelLeftIcon size={16} />
            </IconButton>
          )}
          <IconButton label={expanded ? t("files.shrink") : t("files.expand")} aria-pressed={expanded} onClick={toggle_dock_expanded}>
            {expanded ? <ShrinkIcon size={16} /> : <ExpandIcon size={16} />}
          </IconButton>
        </>
      }
    >
      {body()}
    </DockPanel>
  );
};
