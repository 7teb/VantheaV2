import type { NativeImage, WebContents } from "electron";

export type FrameInfo = { frame_id: string; parent_id: string; url: string; session_id: string };

export type CdpSession = { session_id: string; target_id: string; parent_frame_id: string; type: string; url: string };

export type CheckState = boolean | "mixed";

export type AxEntry = {
  ax_node_id: string;
  backend_node_id: number;
  frame_id: string;
  ignored: boolean;
  role: string;
  name: string;
  description: string;
  value: string;
  protected: boolean;
  disabled: boolean;
  checked: CheckState | null;
  selected: CheckState | null;
  expanded: CheckState | null;
  focused: boolean;
  level: number;
};

export type SnapshotRef = AxEntry & { tab_id: string; session_id: string; epoch: number; created_at: number };

export type Snapshot = {
  snapshot_id: string;
  tab_id: string;
  epoch: number;
  created_at: number;
  consumed: boolean;
  refs: Map<string, SnapshotRef>;
  frames: Map<string, FrameInfo>;
};

export type VisualRegion = { ref: string; label: string; box: [number, number, number, number]; confidence: number };

export type Visual = {
  screenshot_id: string;
  tab_id: string;
  epoch: number;
  url: string;
  viewport_width: number;
  viewport_height: number;
  scroll_x: number;
  scroll_y: number;
  zoom_factor: number;
  capture_width: number;
  capture_height: number;
  created_at: number;
  image: NativeImage;
  regions: Map<string, VisualRegion>;
  consumed: boolean;
};

export type BrowserTab = {
  tab_id: string;
  web_contents_id: number;
  guest: WebContents;
  active: boolean;
  attached: boolean;
  loading: boolean;
  url: string;
  title: string;
  epoch: number;
  queue: Promise<unknown>;
  debugger_attached: boolean;
  sessions: Map<string, CdpSession>;
  snapshots: Map<string, Snapshot>;
  snapshot_seq: number;
  visuals: Map<string, Visual>;
  waiters: Set<() => void>;
  release: () => void;
};

export const notify_tab = (tab: Pick<BrowserTab, "waiters">) => {
  for (const waiter of [...tab.waiters]) {
    waiter();
  }
};

export const invalidate_tab = (tab: Pick<BrowserTab, "epoch" | "snapshots" | "visuals" | "waiters">, document_changed: boolean) => {
  if (document_changed) {
    tab.epoch += 1;
  }
  tab.snapshots.clear();
  tab.visuals.clear();
  notify_tab(tab);
};

export const tab_url = (tab: BrowserTab) => (tab.guest.isDestroyed() ? tab.url : tab.guest.getURL() || tab.url);

export const tab_title = (tab: BrowserTab) => (tab.guest.isDestroyed() ? tab.title : tab.guest.getTitle() || tab.title);

export const random_id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 9)}`;

export const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

export const settle_within = <T>(promise: Promise<T>, signal: AbortSignal, timeout_ms: number, label: string): Promise<T> => {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", on_abort);
    };
    const on_abort = () => {
      finish();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`${label} timed out after ${timeout_ms} ms.`));
    }, timeout_ms);
    signal.addEventListener("abort", on_abort, { once: true });
    promise.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error: unknown) => {
        finish();
        reject(error);
      },
    );
  });
};

export const pause = (tab: Pick<BrowserTab, "waiters">, ms: number, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      tab.waiters.delete(wake);
      signal.removeEventListener("abort", on_abort);
    };
    const wake = () => {
      finish();
      resolve();
    };
    const on_abort = () => {
      finish();
      reject(signal.reason);
    };
    const timer = setTimeout(wake, ms);
    tab.waiters.add(wake);
    signal.addEventListener("abort", on_abort, { once: true });
  });
};
