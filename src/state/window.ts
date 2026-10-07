import type { WindowState } from "../../shared/ipc/app.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export const window_store = create_store<WindowState | null>(null);

export const init_window = (): (() => void) => {
  api
    .invoke("window:state")
    .then((state) => window_store.set(state))
    .catch((error) => console.error("[window] window:state failed", error));
  return api.on("window:changed", (state) => window_store.set(state));
};

export const zoom_window = (delta: number) => {
  api.invoke("window:zoom", delta).catch((error) => console.error(`[window] window:zoom failed for delta ${delta}`, error));
};

export const toggle_fullscreen = () => {
  api.invoke("window:fullscreen").catch((error) => console.error("[window] window:fullscreen failed", error));
};

export const minimize_window = () => {
  api.invoke("window:minimize").catch((error) => console.error("[window] window:minimize failed", error));
};

export const toggle_maximize = () => {
  api.invoke("window:toggle_maximize").catch((error) => console.error("[window] window:toggle_maximize failed", error));
};

export const close_window = () => {
  api.invoke("window:close").catch((error) => console.error("[window] window:close failed", error));
};
