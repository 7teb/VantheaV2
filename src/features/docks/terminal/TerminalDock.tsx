import "@xterm/xterm/css/xterm.css";
import { Button, IconButton } from "../../../components/Button.tsx";
import { PlusIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { draft_key } from "../../../state/chat-drafts.ts";
import { add_terminal_tab, close_terminal_tab, select_terminal_tab, terminal_store } from "../../../state/terminal.ts";
import { terminal_group } from "../../../state/terminal-groups.ts";
import { close_dock } from "../../../state/ui.ts";
import { use_store } from "../../../state/use-store.ts";
import type { DockViewProps } from "../dock-view.ts";
import { DockPanel, DockTitle } from "../DockPanel.tsx";
import { DockTabs } from "../DockTabs.tsx";
import { TerminalView } from "./TerminalView.tsx";
import "./TerminalDock.css";

const close_tab = (key: string, tab_id: string) => {
  const last = terminal_group(terminal_store.get(), key).tabs.length === 1;
  close_terminal_tab(tab_id);
  if (last) {
    close_dock();
  }
};

export const TerminalDock = ({ visible, chat_id, project_path }: DockViewProps) => {
  const t = use_t();
  const key = draft_key(chat_id, project_path);
  const { tabs, active_id } = use_store(terminal_store, (state) => terminal_group(state, key));
  const add_tab = () => add_terminal_tab(chat_id, project_path);

  const labels = tabs.map((tab, index) => ({ id: tab.id, label: t("terminal.title_n", { n: index + 1 }), busy: tab.status === "starting" }));
  const title = tabs.length > 1 ? (
    <DockTabs tabs={labels} active_id={active_id} label={t("terminal.tabs")} close_label={t("terminal.close_tab")} on_select={select_terminal_tab} on_close={(tab_id) => close_tab(key, tab_id)} />
  ) : (
    <DockTitle label={t("terminal.title")} />
  );
  const failed = tabs.find((tab) => tab.id === active_id && tab.status === "failed");

  return (
    <DockPanel
      title={title}
      close_label={t("terminal.close")}
      actions={
        <IconButton label={t("terminal.new")} onClick={add_tab}>
          <PlusIcon size={16} />
        </IconButton>
      }
    >
      {tabs.length === 0 ? (
        <div className="terminal-empty">
          <Button icon={<PlusIcon size={14} />} onClick={add_tab}>
            {t("terminal.new")}
          </Button>
        </div>
      ) : (
        <div className="terminal-surface">
          {tabs.map((tab) => (
            <TerminalView key={tab.id} tab_id={tab.id} active={tab.id === active_id} focused={visible && tab.id === active_id} />
          ))}
          {failed && (
            <div className="terminal-failed" role="alert">
              <span>{t("terminal.start_failed")}</span>
              <small>{failed.error}</small>
            </div>
          )}
        </div>
      )}
    </DockPanel>
  );
};
