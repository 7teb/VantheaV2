import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import type { WindowState } from "../../shared/ipc/app.ts";
import { visual_frame_file } from "../../shared/visual-doc.ts";
import { init_spellcheck } from "./spellcheck.ts";

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
      webviewTag: false,
      spellcheck: true,
    },
  });

  const current = window;
  init_spellcheck(current);
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
  current.webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame || event.url === new URL(visual_frame_file, current.webContents.getURL()).href) {
      return;
    }
    console.warn(`[app] blocked a sub-frame navigation of the main window to ${event.url.slice(0, 200)}`);
    event.preventDefault();
  });
  const app_session = current.webContents.session;
  app_session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (!details.isMainFrame) {
      console.warn(`[app] denied ${permission} to a sub-frame of the main window at ${details.requestingUrl.slice(0, 200)}`);
    }
    callback(details.isMainFrame);
  });
  app_session.setPermissionCheckHandler((_contents, permission, _origin, details) => details.isMainFrame && permission !== "deprecated-sync-clipboard-read");

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
