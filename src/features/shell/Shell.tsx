import { useEffect } from "react";
import { layout_store } from "../../state/layout.ts";
import { set_sidebar_collapsed, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { SettingsPage } from "../settings/SettingsPage.tsx";
import { Sidebar } from "../sidebar/Sidebar.tsx";
import { BrandField } from "./BrandField.tsx";
import { DockHost } from "./DockHost.tsx";
import { MainArea } from "./MainArea.tsx";
import { SearchOverlay } from "./SearchOverlay.tsx";
import { Titlebar } from "./Titlebar.tsx";
import { use_shortcuts } from "./use-shortcuts.ts";
import { use_visual_viewport } from "./use-visual-viewport.ts";
import "./Shell.css";

const use_drawer_sidebar = () => {
  useEffect(() => {
    let drawer = layout_store.get().drawer;
    return layout_store.subscribe(() => {
      const next = layout_store.get().drawer;
      if (next && !drawer) {
        set_sidebar_collapsed(true);
      }
      drawer = next;
    });
  }, []);
};

export const Shell = () => {
  use_shortcuts();
  use_drawer_sidebar();
  use_visual_viewport();
  const sidebar_open = use_store(ui_store, (state) => !state.sidebar_collapsed);

  return (
    <div className="shell">
      <BrandField />
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
