export { fake_window, handlers, ipcMain, main_window, trusted_event } from "./git-ipc-stub.ts";

export const adopted: [string, string][] = [];

export const adopt_tabs = (from: string, to: string) => {
  adopted.push([from, to]);
};
