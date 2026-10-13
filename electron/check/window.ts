import { BrowserWindow, nativeImage, type NativeImage, type WebContents } from "electron";
import { main_window } from "../app/window.ts";
import type { Size } from "../../shared/image-fit.ts";
import { aspect_matches } from "../browser/image-space.ts";
import { check_partition } from "./session.ts";

export class CheckFailure extends Error {}

const frame_timeout_ms = 10000;

const subframe_urls = new Set(["about:blank", "about:srcdoc"]);

export const open_check_window = (prefix: string, size: Size): BrowserWindow => {
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    useContentSize: true,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      offscreen: true,
      partition: check_partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      backgroundThrottling: false,
      disableDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  });
  const contents = window.webContents;
  const guard = (event: { url: string; isMainFrame: boolean; preventDefault: () => void }) => {
    if (event.url.startsWith(prefix) || (!event.isMainFrame && subframe_urls.has(event.url))) {
      return;
    }
    console.warn(`[check] blocked a navigation of the checked page to ${event.url.slice(0, 200)}`);
    event.preventDefault();
  };
  contents.on("will-navigate", guard);
  contents.on("will-frame-navigate", guard);
  contents.on("will-redirect", guard);
  contents.setWindowOpenHandler((details) => {
    console.warn(`[check] blocked a popup of the checked page to ${details.url.slice(0, 200)}`);
    return { action: "deny" };
  });
  contents.setAudioMuted(true);
  contents.setFrameRate(60);
  const host = main_window();
  const close = () => {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  };
  host?.once("closed", close);
  window.once("closed", () => host?.off("closed", close));
  return window;
};

const css_frame = (image: NativeImage, viewport: Size): NativeImage => {
  const size = image.getSize();
  if (size.width === viewport.width && size.height === viewport.height) {
    return nativeImage.createFromBitmap(image.toBitmap(), size);
  }
  if (!aspect_matches(size, viewport)) {
    throw new CheckFailure(`The hidden check window rendered a ${size.width}x${size.height} frame for a ${viewport.width}x${viewport.height} viewport.`);
  }
  return image.resize({ width: viewport.width, height: viewport.height, quality: "best" });
};

export const capture_frame = (contents: WebContents, viewport: Size, signal: AbortSignal): Promise<NativeImage> => {
  signal.throwIfAborted();
  return new Promise<NativeImage>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      contents.off("paint", on_paint);
      signal.removeEventListener("abort", on_abort);
    };
    const on_paint = (...[, , image]: [unknown, unknown, NativeImage]) => {
      if (image.isEmpty()) {
        return;
      }
      finish();
      try {
        resolve(css_frame(image, viewport));
      } catch (error) {
        reject(error);
      }
    };
    const on_abort = () => {
      finish();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new CheckFailure("The hidden check window produced no frames."));
    }, frame_timeout_ms);
    signal.addEventListener("abort", on_abort, { once: true });
    contents.on("paint", on_paint);
    contents.invalidate();
  });
};
