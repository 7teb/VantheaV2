import { nativeImage, type NativeImage } from "electron";
import type { NativeSize, Size } from "../../shared/image-fit.ts";
import { aspect_matches, box_to_image, image_square, point_to_css, type Point } from "./image-space.ts";
import { viewport } from "./input.ts";
import { draw_marks, type Mark } from "./marks.ts";
import { fit_native, jpeg_quality } from "./model-image.ts";
import { sweep_stores } from "./refs.ts";
import { take_snapshot } from "./snapshot.ts";
import type { Box, BrowserTab, Visual } from "./state.ts";
import { capture_view, click_with_fallback, verify_region } from "./vision.ts";

export type ScreenshotRef = { ref: string; line: string; box: Box };

export type Screenshot = {
  snapshot_id: string;
  tab_id: string;
  url: string;
  title: string;
  jpeg: Buffer;
  image: Size;
  css: Size;
  scroll: Point;
  refs: ScreenshotRef[];
  notes: string[];
};

export type PointClick = { x: number; y: number; clicked: boolean; target: string };

const check_square_px = 48;

const retake = "Call browser_screenshot again.";

const labeled_jpeg = (fitted: NativeImage, image: Size, refs: ScreenshotRef[]): Buffer => {
  const bitmap = fitted.toBitmap();
  const marks: Mark[] = refs.map((entry) => ({ label: entry.ref, box: entry.box }));
  draw_marks(bitmap, image.width, image.height, marks);
  return nativeImage.createFromBitmap(bitmap, { width: image.width, height: image.height }).toJPEG(jpeg_quality);
};

export const take_screenshot = async (tab: BrowserTab, labels: boolean, rules: NativeSize[], signal: AbortSignal): Promise<Screenshot> => {
  const epoch = tab.epoch;
  const captured = await capture_view(tab, signal);
  const { view } = captured;
  if (!view.width || !view.height) {
    throw new Error("Could not read the browser viewport");
  }
  const css = { width: view.width, height: view.height };
  if (!aspect_matches(captured, css)) {
    throw new Error("Browser screenshot does not match the viewport");
  }
  const fitted = fit_native(captured.image, rules);
  const image = fitted.getSize();
  const snapshot = await take_snapshot(tab, { interactive_only: true, max_chars: null, max_nodes: null, scope: null, visible: view }, signal);
  const after = await viewport(tab, signal);
  if (after.x !== view.x || after.y !== view.y) {
    throw new Error(`The page scrolled while the screenshot was taken. ${retake}`);
  }
  if (tab.epoch !== epoch) {
    throw new Error(`The page changed while the screenshot was taken. ${retake}`);
  }
  const refs = snapshot.lines.flatMap((entry) => (entry.box ? [{ ref: entry.ref, line: entry.line, box: box_to_image(entry.box, css, image) }] : []));
  const jpeg = labels && refs.length ? labeled_jpeg(fitted, image, refs) : fitted.toJPEG(jpeg_quality);
  const visual: Visual = {
    screenshot_id: snapshot.snapshot_id,
    tab_id: tab.tab_id,
    epoch,
    url: snapshot.url,
    viewport_width: css.width,
    viewport_height: css.height,
    scroll_x: view.x,
    scroll_y: view.y,
    zoom_factor: tab.guest.getZoomFactor(),
    capture_width: captured.width,
    capture_height: captured.height,
    image_width: image.width,
    image_height: image.height,
    retake_tool: "browser_screenshot",
    created_at: Date.now(),
    image: captured.image,
    regions: new Map(),
    consumed: false,
  };
  sweep_stores(tab, visual.created_at);
  tab.visuals.set(visual.screenshot_id, visual);
  return { snapshot_id: snapshot.snapshot_id, tab_id: tab.tab_id, url: snapshot.url, title: snapshot.title, jpeg, image, css, scroll: { x: view.x, y: view.y }, refs, notes: snapshot.notes };
};

const screenshot_visual = (tab: BrowserTab, snapshot_id: string): Visual => {
  sweep_stores(tab, Date.now());
  const visual = tab.visuals.get(snapshot_id);
  if (!visual || visual.consumed || visual.retake_tool !== "browser_screenshot") {
    throw new Error(`Screenshot ${snapshot_id} is stale. ${retake}`);
  }
  return visual;
};

export const point_click = async (tab: BrowserTab, snapshot_id: string, requested: Point, signal: AbortSignal): Promise<PointClick> => {
  const visual = screenshot_visual(tab, snapshot_id);
  const image = { width: visual.image_width, height: visual.image_height };
  const point = { x: Math.round(requested.x), y: Math.round(requested.y) };
  if (point.x < 0 || point.y < 0 || point.x >= image.width || point.y >= image.height) {
    throw new Error(`x and y must lie inside the screenshot image, which is ${image.width}x${image.height} px (x 0 to ${image.width - 1}, y 0 to ${image.height - 1}).`);
  }
  const crop = box_to_image(image_square(point, check_square_px, image), image, { width: visual.capture_width, height: visual.capture_height });
  await verify_region(tab, visual, crop, `The page around ${point.x},${point.y} changed since screenshot ${snapshot_id}.`, signal);
  visual.consumed = true;
  const css = point_to_css(point, image, { width: visual.viewport_width, height: visual.viewport_height });
  const clicked = await click_with_fallback(tab, css, `point ${point.x},${point.y} of ${snapshot_id}`, signal);
  return { ...point, ...clicked };
};
