import type { BrowserWindow, WebContents } from "electron";
import { randomBytes } from "node:crypto";
import type { NativeSize, Size } from "../../shared/image-fit.ts";
import { model_jpeg } from "../browser/model-image.ts";
import { error_text, settle_within } from "../browser/state.ts";
import { abortable_sleep } from "../model/transport.ts";
import { as_record, is_record } from "../storage/coerce.ts";
import { count_repeats, page_error } from "./errors.ts";
import { ad_format, control_box, current_scene, find_scene_host, find_stage, horizontal_overflow, layout_facts, list_controls, scroll_to_control, scroll_top, stage_box, two_frames } from "./page-scripts.ts";
import type { Layout, LiveData } from "./report.ts";
import { serve_folder, stop_serving } from "./serve.ts";
import { check_session, listen_blocked } from "./session.ts";
import { capture_frame, CheckFailure, open_check_window } from "./window.ts";

export type Shot = { name: string; png: Buffer; jpeg: Buffer };

export type LiveResult = LiveData & { shots: Shot[] };

export type LiveTarget = { folder: string; project_root: string; fit: NativeSize[]; save: (name: string, png: Buffer) => Promise<void> };

type Viewport = Size & { mobile: boolean };

type Box = { x: number; y: number; w: number; h: number };

type Control = { index: number; tag: string; type: string; w: number; h: number };

type Page = { window: BrowserWindow; contents: WebContents; signal: AbortSignal; viewport: Viewport; result: LiveResult; fit: NativeSize[]; save: LiveTarget["save"] };

const deadline_ms = 170000;

const timeout_text =
  "live check timed out after 170s. If the machine is busy run check_page again. If it happens every time the page is stuck, for example an endless loop or a very heavy frame";

const wide: Viewport = { width: 1440, height: 1100, mobile: false };

const narrow: Viewport = { width: 800, height: 1100, mobile: false };

const phone: Viewport = { width: 390, height: 844, mobile: true };

const send = <T>(page: Page, method: string, params: Record<string, unknown> = {}): Promise<T> =>
  settle_within<T>(page.contents.debugger.sendCommand(method, params), page.signal, deadline_ms, `Check window call ${method}`);

const evaluate = async (page: Page, expression: string): Promise<unknown> => {
  const reply = await send<unknown>(page, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return as_record(as_record(reply).result).value;
};

const pause = async (page: Page, ms: number) => {
  await abortable_sleep(ms, page.signal);
  page.signal.throwIfAborted();
};

const mouse = (page: Page, type: "mousePressed" | "mouseReleased", x: number, y: number) =>
  send(page, "Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });

const click_at = async (page: Page, x: number, y: number) => {
  await mouse(page, "mousePressed", x, y);
  await mouse(page, "mouseReleased", x, y);
};

const shot = async (page: Page, name: string) => {
  const image = await capture_frame(page.contents, page.viewport, page.signal);
  const png = image.toPNG();
  try {
    await page.save(name, png);
  } catch (error) {
    throw new CheckFailure(`Could not save the screenshot ${name}.png: ${error_text(error)}`, { cause: error });
  }
  page.result.shots.push({ name, png, jpeg: model_jpeg(image, page.fit) });
};

const set_viewport = async (page: Page, viewport: Viewport) => {
  page.viewport = viewport;
  page.window.setContentSize(viewport.width, viewport.height);
  await send(page, "Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
};

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : Number.NaN);

const read_box = (value: unknown, what: string): Box => {
  const record = as_record(value);
  const box = { x: finite(record.x), y: finite(record.y), w: finite(record.w), h: finite(record.h) };
  if ([box.x, box.y, box.w, box.h].some(Number.isNaN)) {
    throw new Error(`could not read the position of ${what}`);
  }
  return box;
};

const read_controls = (value: unknown): Control[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const record = as_record(entry);
    if (typeof record.i !== "number" || !Number.isInteger(record.i)) {
      return [];
    }
    return [{ index: record.i, tag: String(record.tag ?? ""), type: String(record.type ?? ""), w: finite(record.w), h: finite(record.h) }];
  });

const read_layout = (value: unknown): Layout | null => {
  if (!is_record(value)) {
    return null;
  }
  const stage = Array.isArray(value.stage) && value.stage.length === 2 ? value.stage.map(finite) : [];
  const zero = finite(value.zero_size_canvases);
  return {
    stage: stage.length === 2 && !stage.some(Number.isNaN) ? [stage[0], stage[1]] : null,
    horizontal_overflow: value.horizontal_overflow === true,
    zero_size_canvases: Number.isNaN(zero) ? 0 : zero,
  };
};

const read_overflow = (value: unknown): boolean => as_record(value).horizontal_overflow === true;

const file_safe = (scene: string) => scene.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);

const play_scenes = async (page: Page) => {
  const scenes: string[] = [];
  page.result.scenes = scenes;
  let taken = 0;
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const scene = await evaluate(page, current_scene);
    if (typeof scene === "string" && scenes[scenes.length - 1] !== scene) {
      scenes.push(scene);
      if (taken < 6) {
        await pause(page, 900);
        await shot(page, `scene_${String(taken).padStart(2, "0")}_s${file_safe(scene)}`);
        taken += 1;
      }
    }
    if (new Set(scenes).size >= 4 && scenes.length >= 5) {
      break;
    }
    await pause(page, 300);
  }
  await evaluate(page, scroll_top);
};

const press_stage = async (page: Page) => {
  const found = await evaluate(page, find_stage);
  await pause(page, 500);
  if (!is_record(found)) {
    return;
  }
  const box = read_box(await evaluate(page, stage_box), "the stage");
  for (let step = 0; step <= 14; step += 1) {
    await send(page, "Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + box.w * (0.2 + (0.6 * step) / 14), y: box.y + box.h * (0.3 + 0.35 * Math.sin(step / 3)) });
    await pause(page, 40);
  }
  await mouse(page, "mousePressed", box.x + box.w * 0.5, box.y + box.h * 0.5);
  await pause(page, 120);
  await mouse(page, "mouseReleased", box.x + box.w * 0.5, box.y + box.h * 0.5);
  page.result.interactions += 1;
};

const use_control = async (page: Page, control: Control) => {
  await evaluate(page, scroll_to_control(control.index));
  await pause(page, 120);
  const box = read_box(await evaluate(page, control_box(control.index)), `control ${control.index} (${control.tag.toLowerCase()})`);
  if (control.type === "range") {
    for (const fraction of [0.1, 0.9, 0.5]) {
      await click_at(page, box.x + box.w * fraction, box.y + box.h / 2);
      await pause(page, 60);
    }
  } else if (control.type === "text" || control.tag === "TEXTAREA") {
    await click_at(page, box.x + 10, box.y + box.h / 2);
    await send(page, "Input.insertText", { text: "TEST" });
    await pause(page, 100);
  } else {
    await click_at(page, box.x + box.w / 2, box.y + box.h / 2);
    await pause(page, 250);
  }
  page.result.interactions += 1;
};

const sequence = async (page: Page, url: string) => {
  await send(page, "Runtime.enable");
  await send(page, "Log.enable");
  await send(page, "Page.enable");
  await send(page, "Emulation.setScrollbarsHidden", { hidden: true });
  await send(page, "Emulation.setFocusEmulationEnabled", { enabled: true });
  await set_viewport(page, wide);
  await send(page, "Page.navigate", { url });
  await pause(page, 2500);
  await evaluate(page, two_frames);
  await capture_frame(page.contents, page.viewport, page.signal);
  await pause(page, 700);
  await shot(page, "wide_a");
  await pause(page, 1500);
  await shot(page, "wide_still");
  const has_scenes = (await evaluate(page, find_scene_host)) === true;
  if (has_scenes) {
    await play_scenes(page);
  }
  await press_stage(page);
  await pause(page, 1200);
  await shot(page, "wide_b");
  for (const control of read_controls(await evaluate(page, list_controls))) {
    if (control.w !== 0 && control.h !== 0) {
      await use_control(page, control);
    }
  }
  await pause(page, 600);
  if (has_scenes) {
    const format = await evaluate(page, ad_format);
    page.result.ad_format = typeof format === "string" ? format : null;
  }
  page.result.layout = read_layout(await evaluate(page, layout_facts));
  await set_viewport(page, narrow);
  await pause(page, 900);
  await shot(page, "narrow");
  page.result.narrow_overflow = read_overflow(await evaluate(page, horizontal_overflow));
  await set_viewport(page, phone);
  await pause(page, 900);
  await shot(page, "phone");
  page.result.phone_overflow = read_overflow(await evaluate(page, horizontal_overflow));
};

const setup_failure = (error: unknown) => new CheckFailure(`Could not open the hidden check window: ${error_text(error)}`, { cause: error });

const open_window = (prefix: string): BrowserWindow => {
  try {
    return open_check_window(prefix, wide);
  } catch (error) {
    throw setup_failure(error);
  }
};

const attach_page = async (window: BrowserWindow, result: LiveResult, target: LiveTarget, controller: AbortController): Promise<Page> => {
  const contents = window.webContents;
  try {
    contents.on("render-process-gone", (...[, details]) => controller.abort(new Error(`the page's renderer process is gone (${details.reason})`)));
    await settle_within(window.loadURL("about:blank"), controller.signal, deadline_ms, "Opening the check window");
    contents.debugger.attach("1.3");
    contents.debugger.on("message", (...[, method, params]) => {
      const error = page_error(method, params);
      if (error) {
        result.errors.push(error);
      }
    });
    contents.debugger.on("detach", (...[, reason]) => controller.abort(new Error(`the check window's debugger detached (${reason})`)));
    return { window, contents, signal: controller.signal, viewport: wide, result, fit: target.fit, save: target.save };
  } catch (error) {
    if (controller.signal.aborted) {
      throw error;
    }
    throw setup_failure(error);
  }
};

let tail: Promise<void> = Promise.resolve();

const one_at_a_time = async <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
  const previous = tail;
  let done = () => {};
  const mine = new Promise<void>((resolve) => {
    done = resolve;
  });
  tail = previous.then(() => mine);
  try {
    await settle_within(previous, signal, deadline_ms * 2, "Waiting for the running page check");
    return await work();
  } finally {
    done();
  }
};

const live_check = async (target: LiveTarget, outer: AbortSignal): Promise<LiveResult> => {
  const result: LiveResult = { errors: [], blocked: [], interactions: 0, layout: null, narrow_overflow: false, phone_overflow: false, scenes: null, ad_format: null, shots: [] };
  const token = randomBytes(16).toString("hex");
  const prefix = `vx-check://${token}/`;
  const session = check_session();
  await session.clearStorageData();
  await session.clearCache();
  outer.throwIfAborted();
  const controller = new AbortController();
  const stop = () => controller.abort(outer.reason);
  let timed_out = false;
  const deadline = setTimeout(() => {
    timed_out = true;
    controller.abort(new Error(timeout_text));
  }, deadline_ms);
  outer.addEventListener("abort", stop, { once: true });
  serve_folder(token, { folder: target.folder, project_root: target.project_root });
  listen_blocked((url) => {
    const shown = url.slice(0, 300);
    if (result.blocked.length < 6 && !result.blocked.includes(shown)) {
      result.blocked.push(shown);
    }
  });
  let window: BrowserWindow | null = null;
  try {
    window = open_window(prefix);
    await sequence(await attach_page(window, result, target, controller), `${prefix}index.html`);
  } catch (error) {
    if (outer.aborted || error instanceof CheckFailure) {
      throw error;
    }
    result.errors.push(timed_out ? timeout_text : `live check crashed: ${error_text(error)}`);
  } finally {
    clearTimeout(deadline);
    outer.removeEventListener("abort", stop);
    listen_blocked(null);
    stop_serving(token);
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }
  return { ...result, errors: count_repeats(result.errors) };
};

export const run_live_check = (target: LiveTarget, signal: AbortSignal): Promise<LiveResult> => one_at_a_time(signal, () => live_check(target, signal));
