export { fake_window, handlers, ipcMain, main_window, parse_scope, require_root, sent, trusted_event } from "./git-ipc-stub.ts";

export const net = { fetch: () => Promise.reject(new Error("no network in this test")) };

export const app = { getAppPath: () => process.cwd() };
