import type { BrowserWindow } from "electron";
import type { BrowserRect, BrowserViewport } from "../../shared/ipc/browser.ts";
import type { BrowserTab } from "./state.ts";
import { default_tab_size } from "./surface.ts";
import { active_tab, close_all_tabs, is_open, on_tabs_changed } from "./tabs.ts";

const frame_quality = 85;

let host: BrowserWindow | null = null;
let viewport: BrowserViewport | null = null;
let shown: BrowserTab | null = null;
let stop_following: (() => void) | null = null;

const scaled = (rect: BrowserRect, zoom: number) => ({
  x: Math.round(rect.x * zoom),
  y: Math.round(rect.y * zoom),
  width: Math.max(1, Math.round(rect.width * zoom)),
  height: Math.max(1, Math.round(rect.height * zoom)),
});

const park = (tab: BrowserTab) => {
  if (!is_open(tab) || tab.host === tab.surface) {
    return;
  }
  tab.view.setBorderRadius(0);
  tab.surface.contentView.addChildView(tab.view);
  tab.host = tab.surface;
  tab.view.setBounds({ x: 0, y: 0, ...default_tab_size });
};

const show = (window: BrowserWindow, tab: BrowserTab, rect: BrowserRect, radius: number) => {
  const zoom = window.webContents.getZoomFactor();
  const bounds = scaled(rect, zoom);
  if (tab.host !== window) {
    window.contentView.addChildView(tab.view);
    tab.host = window;
  }
  tab.view.setBounds(bounds);
  tab.view.setBorderRadius(Math.round(radius * zoom));
};

const wanted = (): BrowserTab | null => {
  if (!host || host.isDestroyed() || host.isMinimized() || !viewport?.rect) {
    return null;
  }
  return active_tab(viewport.chat_id);
};

export const place_dock = () => {
  const next = wanted();
  if (shown && shown !== next) {
    park(shown);
  }
  shown = next;
  if (next && host && viewport?.rect) {
    show(host, next, viewport.rect, viewport.radius);
  }
};

export const set_viewport = (next: BrowserViewport) => {
  viewport = next;
  place_dock();
};

export const shown_tab = () => (shown && is_open(shown) ? shown : null);

export const freeze_frame = async (chat_id: string): Promise<string | null> => {
  const tab = shown_tab();
  if (!tab || tab.chat_id !== chat_id) {
    return null;
  }
  const image = await tab.guest.capturePage();
  return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(frame_quality).toString("base64")}`;
};

const release_host = () => {
  stop_following?.();
  stop_following = null;
  host = null;
  viewport = null;
  shown = null;
};

const forget_viewport = () => {
  viewport = null;
  place_dock();
};

export const init_dock = (window: BrowserWindow) => {
  host = window;
  stop_following = on_tabs_changed(place_dock);
  window.on("minimize", place_dock);
  window.on("restore", place_dock);
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame) {
      forget_viewport();
    }
  });
  window.webContents.on("render-process-gone", forget_viewport);
  window.once("closed", () => {
    release_host();
    close_all_tabs();
  });
};
