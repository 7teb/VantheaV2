import { app, Menu, Tray, type BrowserWindow } from "electron";
import path from "node:path";
import type { Language } from "../../shared/settings.ts";
import { get_settings } from "../settings/store.ts";
import { main_window } from "./window.ts";

const labels: Record<Language, { open: string; quit: string }> = {
  en: { open: "Open VantheaX", quit: "Quit VantheaX" },
  de: { open: "VantheaX öffnen", quit: "VantheaX beenden" },
};

let tray: Tray | null = null;
let quitting = false;

export const mark_quitting = (): void => {
  quitting = true;
};

export const show_window = (): void => {
  const window = main_window();
  if (!window) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
};

const quit_app = (): void => {
  app.quit();
};

const tray_menu = (): Menu => {
  const text = labels[get_settings().language];
  return Menu.buildFromTemplate([{ label: text.open, click: show_window }, { type: "separator" }, { label: text.quit, click: quit_app }]);
};

export const init_tray = (window: BrowserWindow): void => {
  tray = new Tray(path.join(app.getAppPath(), "Resources", "VantheaX.ico"));
  tray.setToolTip("VantheaX");
  tray.on("click", show_window);
  tray.on("right-click", () => tray?.popUpContextMenu(tray_menu()));
  window.on("close", (event) => {
    if (quitting) {
      return;
    }
    event.preventDefault();
    window.hide();
  });
  window.on("session-end", quit_app);
};

export const shutdown_tray = (): void => {
  tray?.destroy();
  tray = null;
};
