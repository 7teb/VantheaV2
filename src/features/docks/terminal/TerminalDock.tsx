import { useEffect } from "react";
import "@xterm/xterm/css/xterm.css";
import { IconButton } from "../../../components/Button.tsx";
import { PlusIcon } from "../../../components/icons.tsx";
import { Skeleton, SkeletonLines } from "../../../components/Skeleton.tsx";
import { use_t } from "../../../i18n/index.ts";
import { add_terminal_tab, close_terminal_tab, ensure_terminal_tab, select_terminal_tab, terminal_store } from "../../../state/terminal.ts";
import { close_dock } from "../../../state/ui.ts";
import { use_store } from "../../../state/use-store.ts";
import type { DockViewProps } from "../dock-view.ts";
import { DockPanel, DockTitle } from "../DockPanel.tsx";
import { DockTabs } from "../DockTabs.tsx";
import { dispose_session } from "./terminal-sessions.ts";
import { TerminalView } from "./TerminalView.tsx";
import "./TerminalDock.css";

const close_tab = (tab_id: string) => {
  const last = terminal_store.get().tabs.length === 1;
  dispose_session(tab_id);
  close_terminal_tab(tab_id);
  if (last) {
    close_dock();
  }
};

const TerminalSkeleton = () => (
  <div className="terminal-skeleton" aria-busy="true">
    <Skeleton width={180} height={12} radius={4} />
    <SkeletonLines widths={[72, 46, 64]} height={12} gap={10} />
  </div>
);

export const TerminalDock = ({ visible, project_path }: DockViewProps) => {
  const t = use_t();
  const tabs = use_store(terminal_store, (state) => state.tabs);
  const active_id = use_store(terminal_store, (state) => state.active_id);

  useEffect(() => {
    if (visible) {
      ensure_terminal_tab(project_path);
    }
  }, [visible, project_path]);

  const labels = tabs.map((tab, index) => ({ id: tab.id, label: t("terminal.title_n", { n: index + 1 }), busy: tab.status === "starting" }));
  const title = tabs.length > 1 ? (
    <DockTabs tabs={labels} active_id={active_id} label={t("terminal.tabs")} close_label={t("terminal.close_tab")} on_select={select_terminal_tab} on_close={close_tab} />
  ) : (
    <DockTitle label={t("terminal.title")} />
  );
  const failed = tabs.find((tab) => tab.id === active_id && tab.status === "failed");

  return (
    <DockPanel
      title={title}
      close_label={t("terminal.close")}
      actions={
        <IconButton label={t("terminal.new")} onClick={() => add_terminal_tab(project_path)}>
          <PlusIcon size={16} />
        </IconButton>
      }
    >
      <div className="terminal-surface inset-surface">
        {tabs.length === 0 ? (
          <TerminalSkeleton />
        ) : (
          tabs.map((tab) => (
            <TerminalView key={tab.id} tab_id={tab.id} active={tab.id === active_id} focused={visible && tab.id === active_id} />
          ))
        )}
        {failed && (
          <div className="terminal-failed" role="alert">
            <span>{t("terminal.start_failed")}</span>
            <small>{failed.error}</small>
          </div>
        )}
      </div>
    </DockPanel>
  );
};
