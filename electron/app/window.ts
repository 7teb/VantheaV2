import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import type { WindowState } from "../../shared/ipc/app.ts";

let window: BrowserWindow | null = null;

export const main_window = () => window;

export const window_state = (): WindowState => ({
  maximized: Boolean(window?.isMaximized()),
  fullscreen: Boolean(window?.isFullScreen()),
  focused: Boolean(window?.isFocused()),
  zoom: window?.webContents.getZoomLevel() ?? 0,
});

const is_external_url = (url: string) => /^https?:\/\//i.test(url);

export const create_window = (on_state: (state: WindowState) => void) => {
  const app_root = app.getAppPath();
  window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: "#060606",
    icon: path.join(app_root, "Resources", "Logo-taskbar.png"),
    webPreferences: {
      preload: path.join(app_root, "dist-electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
    },
  });

  const current = window;
  const push_state = () => on_state(window_state());
  current.on("maximize", push_state);
  current.on("unmaximize", push_state);
  current.on("enter-full-screen", push_state);
  current.on("leave-full-screen", push_state);
  current.on("focus", push_state);
  current.on("blur", push_state);
  current.webContents.on("zoom-changed", push_state);
  current.on("closed", () => {
    window = null;
  });

  current.webContents.setWindowOpenHandler(({ url }) => {
    if (is_external_url(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  current.webContents.on("will-navigate", (event, url) => {
    const dev_url = process.env.VITE_DEV_SERVER_URL;
    if (dev_url && url.startsWith(dev_url)) {
      return;
    }
    event.preventDefault();
    if (is_external_url(url)) {
      void shell.openExternal(url);
    }
  });

  current.once("ready-to-show", () => {
    current.maximize();
    current.show();
  });

  const dev_url = process.env.VITE_DEV_SERVER_URL;
  if (dev_url) {
    void current.loadURL(dev_url);
  } else {
    void current.loadFile(path.join(app_root, "dist", "index.html"));
  }
  return current;
};
