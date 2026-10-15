import { useEffect } from "react";
import { IconButton } from "../../../components/Button.tsx";
import { ExpandIcon, PanelLeftIcon, ShrinkIcon } from "../../../components/icons.tsx";
import { SkeletonRows } from "../../../components/Skeleton.tsx";
import { use_t } from "../../../i18n/index.ts";
import { files_store, shown_view, sync_files, toggle_tree, unwatch_files, watch_files } from "../../../state/files.ts";
import { toggle_dock_expanded, ui_store } from "../../../state/ui.ts";
import { use_store } from "../../../state/use-store.ts";
import type { DockViewProps } from "../dock-view.ts";
import { DockEmpty, DockPanel, DockTitle } from "../DockPanel.tsx";
import { FileTree } from "./FileTree.tsx";
import { FileViewer } from "./FileViewer.tsx";
import "./FilesDock.css";

export const FilesDock = ({ visible, chat_id, project_path }: DockViewProps) => {
  const t = use_t();
  const root = use_store(files_store, (state) => shown_view(state).root);
  const has_tabs = use_store(files_store, (state) => shown_view(state).tabs.length > 0);
  const tree_open = use_store(files_store, (state) => shown_view(state).tree_open);
  const expanded = use_store(ui_store, (state) => state.dock.expanded);

  useEffect(() => {
    if (!visible) {
      return;
    }
    void sync_files();
    watch_files();
    return unwatch_files;
  }, [visible, chat_id, project_path]);

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
    return (
      <div className="files-split" data-tree={tree_open || !has_tabs} data-viewer={has_tabs}>
        <FileTree />
        {has_tabs && <FileViewer />}
      </div>
    );
  };

  const name = root.root?.kind === "workspace" ? t("files.workspace") : root.root?.name;

  return (
    <DockPanel
      title={<DockTitle label={t("files.title")} meta={name} />}
      close_label={t("files.close")}
      actions={
        <>
          {has_tabs && (
            <IconButton label={tree_open ? t("files.hide_tree") : t("files.show_tree")} aria-pressed={!tree_open} onClick={toggle_tree}>
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
