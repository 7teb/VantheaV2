import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../../components/Button.tsx";
import { PlusIcon } from "../../../components/icons.tsx";
import { Skeleton } from "../../../components/Skeleton.tsx";
import { use_t } from "../../../i18n/index.ts";
import { add_browser_tab, browser_partition, browser_store, close_browser_tab, mount_browser, select_browser_tab } from "../../../state/browser.ts";
import { close_dock } from "../../../state/ui.ts";
import { use_store } from "../../../state/use-store.ts";
import type { DockViewProps } from "../dock-view.ts";
import { DockPanel } from "../DockPanel.tsx";
import { DockTabs } from "../DockTabs.tsx";
import { tab_label } from "./browser-url.ts";
import { BrowserToolbar } from "./BrowserToolbar.tsx";
import { BrowserView } from "./BrowserView.tsx";
import "./BrowserDock.css";

type PartitionState = { status: "loading" } | { status: "ready"; partition: string } | { status: "failed"; error: string };

const use_partition = () => {
  const [state, set_state] = useState<PartitionState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    browser_partition()
      .then((partition) => {
        if (alive) {
          set_state({ status: "ready", partition });
        }
      })
      .catch((error: unknown) => {
        console.error("[browser] browser:partition failed", error);
        if (alive) {
          set_state({ status: "failed", error: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
};

const close_tab = (tab_id: string) => {
  if (browser_store.get().tabs.length === 1) {
    close_dock();
    return;
  }
  close_browser_tab(tab_id);
};

const BrowserSkeleton = () => (
  <div className="browser-skeleton" aria-busy="true">
    <Skeleton width="100%" height="100%" radius={0} />
  </div>
);

export const BrowserDock = ({ visible }: DockViewProps) => {
  const t = use_t();
  const tabs = use_store(browser_store, (state) => state.tabs);
  const active_id = use_store(browser_store, (state) => state.active_id);
  const partition = use_partition();
  const url_focused = useRef(false);
  const active = tabs.find((tab) => tab.id === active_id) ?? null;

  useEffect(() => mount_browser(), []);

  useEffect(() => {
    if (visible && browser_store.get().tabs.length === 0) {
      add_browser_tab();
    }
  }, [visible, tabs.length]);

  const entries = tabs.map((tab) => ({ id: tab.id, label: tab_label(tab.title, tab.url, t("browser.new_tab")), busy: tab.loading }));

  return (
    <DockPanel
      className="browser-dock"
      title={<DockTabs tabs={entries} active_id={active_id} label={t("browser.tabs")} close_label={t("browser.close_tab")} on_select={select_browser_tab} on_close={close_tab} />}
      close_label={t("browser.close")}
      actions={
        <IconButton label={t("browser.add_tab")} onClick={() => add_browser_tab()}>
          <PlusIcon size={16} />
        </IconButton>
      }
      toolbar={<BrowserToolbar tab={active} visible={visible} url_focused={url_focused} />}
    >
      <div className="browser-views">
        {partition.status === "loading" && <BrowserSkeleton />}
        {partition.status === "failed" && (
          <div className="browser-error" role="alert">
            <span>{t("browser.unavailable")}</span>
            <small>{partition.error}</small>
          </div>
        )}
        {partition.status === "ready" &&
          tabs.map((tab) => <BrowserView key={tab.id} tab={tab} active={tab.id === active_id} partition={partition.partition} url_focused={url_focused} />)}
      </div>
    </DockPanel>
  );
};
