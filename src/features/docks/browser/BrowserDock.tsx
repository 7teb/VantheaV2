import { useEffect } from "react";
import { IconButton } from "../../../components/Button.tsx";
import { PlusIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { browser_chat_key, browser_store, close_browser_tab, ensure_browser_tab, no_browser_tabs, open_browser_tab, select_browser_tab, sync_browser } from "../../../state/browser.ts";
import { close_dock } from "../../../state/ui.ts";
import { use_store } from "../../../state/use-store.ts";
import type { DockViewProps } from "../dock-view.ts";
import { DockPanel } from "../DockPanel.tsx";
import { DockTabs } from "../DockTabs.tsx";
import { tab_label } from "./browser-url.ts";
import { BrowserToolbar } from "./BrowserToolbar.tsx";
import { BrowserViewport } from "./BrowserViewport.tsx";
import "./BrowserDock.css";

export const BrowserDock = ({ visible, chat_id }: DockViewProps) => {
  const t = use_t();
  const chat_key = browser_chat_key(chat_id);
  const loaded = use_store(browser_store, (state) => chat_key in state.chats);
  const tabs = use_store(browser_store, (state) => state.chats[chat_key]?.tabs ?? no_browser_tabs);
  const active_id = use_store(browser_store, (state) => state.chats[chat_key]?.active_id ?? "");
  const active = tabs.find((tab) => tab.tab_id === active_id) ?? null;

  useEffect(() => {
    void sync_browser(chat_key);
  }, [chat_key]);

  useEffect(() => {
    if (visible && loaded && tabs.length === 0) {
      void ensure_browser_tab(chat_key);
    }
  }, [visible, loaded, tabs.length, chat_key]);

  const close_tab = (tab_id: string) => {
    if (tabs.length === 1) {
      close_dock();
    }
    void close_browser_tab(chat_key, tab_id);
  };

  const entries = tabs.map((tab) => ({ id: tab.tab_id, label: tab_label(tab.title, tab.url, t("browser.new_tab")), busy: tab.loading }));

  return (
    <DockPanel
      className="browser-dock"
      title={
        <DockTabs
          tabs={entries}
          active_id={active_id}
          label={t("browser.tabs")}
          close_label={t("browser.close_tab")}
          on_select={(tab_id) => void select_browser_tab(chat_key, tab_id)}
          on_close={close_tab}
        />
      }
      close_label={t("browser.close")}
      actions={
        <IconButton label={t("browser.add_tab")} onClick={() => void open_browser_tab(chat_key)}>
          <PlusIcon size={16} />
        </IconButton>
      }
      toolbar={<BrowserToolbar chat_key={chat_key} tab={active} visible={visible} />}
    >
      <div className="browser-views">
        <BrowserViewport chat_key={chat_key} tab={active} visible={visible} />
      </div>
    </DockPanel>
  );
};
