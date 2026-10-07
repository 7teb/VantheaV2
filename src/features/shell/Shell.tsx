import { useEffect } from "react";
import { set_sidebar_collapsed, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { SettingsPage } from "../settings/SettingsPage.tsx";
import { Sidebar } from "../sidebar/Sidebar.tsx";
import { DockHost } from "./DockHost.tsx";
import { MainArea } from "./MainArea.tsx";
import { SearchOverlay } from "./SearchOverlay.tsx";
import { Titlebar } from "./Titlebar.tsx";
import { use_shortcuts } from "./use-shortcuts.ts";
import "./Shell.css";

const narrow_query = "(max-width: 860px)";

const use_narrow_sidebar = () => {
  useEffect(() => {
    const media = window.matchMedia(narrow_query);
    const sync = () => {
      if (media.matches) {
        set_sidebar_collapsed(true);
      }
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
};

export const Shell = () => {
  use_shortcuts();
  use_narrow_sidebar();
  const sidebar_open = use_store(ui_store, (state) => !state.sidebar_collapsed);

  return (
    <div className="shell">
      <Titlebar />
      <div className="shell-body">
        <Sidebar />
        <div className="sidebar-scrim" data-open={sidebar_open} aria-hidden="true" onClick={() => set_sidebar_collapsed(true)} />
        <MainArea />
        <DockHost />
        <SettingsPage />
      </div>
      <SearchOverlay />
    </div>
  );
};
