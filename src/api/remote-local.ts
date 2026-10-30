import type { WindowState } from "../../shared/ipc/app.ts";
import type { InvokeName } from "../../shared/ipc/index.ts";
import { media_path } from "../../shared/remote-wire.ts";
import type { MediaBucket } from "./media-url.ts";

type LocalHandler = (args: unknown[]) => unknown;

type WindowListener = (state: WindowState) => void;

export const remote_media_url = (bucket: MediaBucket, id: string) => `${media_path}/${bucket}/${encodeURIComponent(id)}`;

const window_state = (): WindowState => ({
  maximized: false,
  fullscreen: Boolean(document.fullscreenElement),
  focused: document.hasFocus() && document.visibilityState === "visible",
  zoom: 0,
});

const open_external = (url: unknown) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    throw new Error(`refusing to open non-http url: ${String(url)}`);
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

const download_image = (artifact_id: unknown) => {
  const id = String(artifact_id);
  try {
    const anchor = document.createElement("a");
    anchor.href = remote_media_url("image", id);
    anchor.download = id;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch (error) {
    console.error(`[remote] downloading the image ${id} failed`, error);
    return false;
  }
};

const local_handlers: Partial<Record<InvokeName, LocalHandler>> = {
  "window:state": () => window_state(),
  "shell:open_external": ([url]) => open_external(url),
  "artifacts:export": ([artifact_id]) => download_image(artifact_id),
};

export const invoke_local = (name: InvokeName, args: unknown[]): Promise<unknown> => {
  const handler = local_handlers[name];
  if (!handler) {
    return Promise.reject(new Error(`${name} has no device implementation`));
  }
  try {
    return Promise.resolve(handler(args));
  } catch (error) {
    return Promise.reject(error);
  }
};

const window_listeners = new Set<WindowListener>();

let watching = false;

const notify_window = () => {
  const state = window_state();
  for (const listener of [...window_listeners]) {
    listener(state);
  }
};

const watch_window = () => {
  if (watching) {
    return;
  }
  watching = true;
  window.addEventListener("focus", notify_window);
  window.addEventListener("blur", notify_window);
  document.addEventListener("visibilitychange", notify_window);
  document.addEventListener("fullscreenchange", notify_window);
};

export const on_window_changed = (listener: WindowListener): (() => void) => {
  watch_window();
  window_listeners.add(listener);
  return () => {
    window_listeners.delete(listener);
  };
};
