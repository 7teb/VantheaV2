import { app, BrowserWindow, globalShortcut, screen } from "electron";
import path from "node:path";
import type { ComputerSession } from "../../shared/ipc/computer.ts";
import type { Display } from "./coords.ts";

let window: BrowserWindow | null = null;
let loaded: Promise<void> | null = null;
let shortcut = false;
let target = "";
let stop = () => {};
let state = (): ComputerSession => ({ chat_id: null, shortcut: false });
const accelerator = "CommandOrControl+Alt+Escape";

export const indicator_window = () => window;

export const init_indicator = (on_stop: () => void, read_state: () => ComputerSession) => {
  stop = on_stop;
  state = read_state;
};

export const update_indicator = (session: ComputerSession) => {
  if (window && !window.isDestroyed()) window.webContents.send("computer:changed", session);
};

export const resize_indicator = (width: number, height: number) => {
  if (!window || !Number.isFinite(width) || !Number.isFinite(height)) return;
  const area = screen.getDisplayMatching(window.getBounds()).workArea;
  const size = { width: Math.min(area.width, Math.max(180, Math.ceil(width))), height: Math.min(area.height, Math.max(36, Math.ceil(height))) };
  window.setContentSize(size.width, size.height);
};

export const show_indicator = async (display: Display): Promise<boolean> => {
  if (!window || window.isDestroyed()) {
    const created = new BrowserWindow({ width: 680, height: 76, show: false, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, focusable: false, skipTaskbar: true, webPreferences: { preload: path.join(app.getAppPath(), "dist-electron", "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
    window = created;
    created.setAlwaysOnTop(true, "screen-saver");
    created.setContentProtection(true);
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.webContents.on("will-frame-navigate", (event) => event.preventDefault());
    created.webContents.on("render-process-gone", () => { stop(); });
    created.on("closed", () => { if (window === created) { window = null; loaded = null; } });
    const dev = process.env.VITE_DEV_SERVER_URL;
    loaded = dev ? created.loadURL(new URL("indicator.html", dev).href) : created.loadFile(path.join(app.getAppPath(), "dist", "indicator.html"));
  }
  await loaded;
  if (!window || window.isDestroyed()) throw new Error("The computer-use indicator could not be opened");
  if (!shortcut) shortcut = globalShortcut.register(accelerator, () => stop());
  if (!window.isVisible() || target !== display.id) {
    const point = screen.screenToDipPoint({ x: display.x + Math.round(display.width / 2), y: display.y + Math.round(display.height / 2) });
    const area = screen.getDisplayNearestPoint(point).workArea;
    const [width] = window.getSize();
    window.setPosition(Math.round(area.x + (area.width - width) / 2), area.y + 8);
    target = display.id;
  }
  window.showInactive();
  update_indicator(state());
  return shortcut;
};

export const hide_indicator = () => {
  if (shortcut) globalShortcut.unregister(accelerator);
  shortcut = false;
  window?.hide();
};

export const close_indicator = () => {
  hide_indicator();
  window?.destroy();
  window = null;
  loaded = null;
};
