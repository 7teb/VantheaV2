import { shell } from "electron";
import { main_window, window_state } from "../app/window.ts";
import { handle } from "./handle.ts";

const clamp_zoom = (level: number) => Math.min(4, Math.max(-3, Math.round(level)));

export const register_app_ipc = () => {
  handle("window:minimize", () => {
    main_window()?.minimize();
  });
  handle("window:toggle_maximize", () => {
    const window = main_window();
    if (!window) {
      return;
    }
    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }
    window.maximize();
  });
  handle("window:close", () => {
    main_window()?.close();
  });
  handle("window:fullscreen", () => {
    const window = main_window();
    window?.setFullScreen(!window.isFullScreen());
  });
  handle("window:state", () => window_state());
  handle("window:zoom", (delta) => {
    const contents = main_window()?.webContents;
    if (!contents) {
      return 0;
    }
    const level = delta === 0 ? 0 : clamp_zoom(contents.getZoomLevel() + delta);
    contents.setZoomLevel(level);
    return level;
  });
  handle("shell:open_external", async (url) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`refusing to open non-http url: ${url}`);
    }
    await shell.openExternal(url);
  });
  handle("shell:reveal", (target) => {
    shell.showItemInFolder(target);
  });
};
