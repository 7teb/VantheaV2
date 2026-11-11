import { app, Menu, protocol } from "electron";
import { init_services, report_startup_failure, shutdown_services } from "./app/lifecycle.ts";
import { init_tray, mark_quitting, show_window, shutdown_tray } from "./app/tray.ts";
import { create_window } from "./app/window.ts";
import { init_dock } from "./browser/dock.ts";
import { check_scheme } from "./check/session.ts";
import { emit } from "./ipc/handle.ts";
import { register_ipc } from "./ipc/index.ts";
import { media_scheme } from "./media/protocol.ts";
import { start_scheduled_tasks } from "./scheduled/index.ts";

protocol.registerSchemesAsPrivileged([media_scheme, check_scheme]);
app.commandLine.appendSwitch("disable-lcd-text");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

const start = async () => {
  Menu.setApplicationMenu(null);
  const { mcp_settled } = await init_services();
  register_ipc();
  const window = create_window((state) => emit("window:changed", state));
  init_tray(window);
  init_dock(window);
  start_scheduled_tasks(mcp_settled);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("dev.local.vantheax");
  app.on("second-instance", show_window);
  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", () => {
    mark_quitting();
    shutdown_tray();
    shutdown_services();
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      report_startup_failure(error);
      app.exit(1);
    });
}
