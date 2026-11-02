import { remote_client } from "../../api/bridge.ts";
import { IconButton } from "../../components/Button.tsx";
import { PanelLeftIcon, SearchIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { chats_store } from "../../state/chats.ts";
import { open_search, toggle_dock, toggle_sidebar, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { ActivityBell } from "../sidebar/ActivityBell.tsx";
import { chat_label } from "../sidebar/sidebar-model.ts";
import { dock_toggles, titlebar_docks } from "./docks.ts";
import { RemoteConnection } from "./RemoteConnection.tsx";
import { RemoteToggle } from "./RemoteToggle.tsx";
import { shortcut_hint } from "./shortcuts.ts";
import { TitlebarMenu } from "./TitlebarMenu.tsx";
import { WindowControls } from "./WindowControls.tsx";
import { wordmark } from "./wordmark.ts";
import "./Titlebar.css";

export const Titlebar = () => {
  const t = use_t();
  const collapsed = use_store(ui_store, (state) => state.sidebar_collapsed);
  const open_dock = use_store(ui_store, (state) => state.dock.kind);
  const active_chat_id = use_store(ui_store, (state) => state.active_chat_id);
  const settings_open = use_store(ui_store, (state) => state.settings_open);
  const chat_title = use_store(chats_store, (state) => state.list.find((chat) => chat.id === active_chat_id)?.title);
  const chat_text = chat_title === undefined ? "" : chat_label(t, chat_title);
  const title = settings_open ? t("settings.title") : chat_text;

  return (
    <header className="titlebar" data-sidebar={collapsed ? "closed" : "open"}>
      <div className="titlebar-start">
        <span className="titlebar-brand">{wordmark}</span>
        <span className="titlebar-actions">
          <ActivityBell />
          <IconButton label={t("sidebar.search")} hint={shortcut_hint("search")} className="titlebar-search" onClick={open_search}>
            <SearchIcon />
          </IconButton>
          <IconButton
            label={collapsed ? t("shell.sidebar_open") : t("shell.sidebar_close")}
            hint={shortcut_hint("toggle_sidebar")}
            aria-expanded={!collapsed}
            className="titlebar-sidebar-toggle"
            onClick={toggle_sidebar}
          >
            <PanelLeftIcon />
          </IconButton>
        </span>
      </div>
      <div className="titlebar-title">
        <span className="titlebar-title-text">{title}</span>
        <RemoteConnection />
      </div>
      <div className="titlebar-end">
        <div className="titlebar-docks">
          {titlebar_docks.map((kind) => {
            const { label, icon: DockIcon } = dock_toggles[kind];
            return (
              <IconButton
                key={kind}
                label={t(label)}
                active={open_dock === kind}
                aria-pressed={open_dock === kind}
                className="titlebar-dock"
                data-dock={kind}
                onClick={() => toggle_dock(kind)}
              >
                <DockIcon />
              </IconButton>
            );
          })}
          {!remote_client && <RemoteToggle />}
          <TitlebarMenu />
        </div>
        {!remote_client && (
          <>
            <span className="titlebar-divider" aria-hidden="true" />
            <WindowControls />
          </>
        )}
      </div>
    </header>
  );
};
