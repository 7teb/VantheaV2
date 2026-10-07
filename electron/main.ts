import { app, Menu } from "electron";
import { init_services, report_startup_failure, shutdown_services } from "./app/lifecycle.ts";
import { create_window, main_window } from "./app/window.ts";
import { emit } from "./ipc/handle.ts";
import { register_ipc } from "./ipc/index.ts";
import { register_media_scheme } from "./media/protocol.ts";

register_media_scheme();

const start = async () => {
  Menu.setApplicationMenu(null);
  await init_services();
  register_ipc();
  create_window((state) => emit("window:changed", state));
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("dev.local.vantheax");
  app.on("second-instance", () => {
    const window = main_window();
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", shutdown_services);
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      report_startup_failure(error);
      app.exit(1);
    });
}
