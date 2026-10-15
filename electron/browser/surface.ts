import { BaseWindow, screen, type Rectangle } from "electron";
import type { TabSize } from "./state.ts";

export const default_tab_size: TabSize = { width: 1280, height: 800 };

const offscreen_gap_px = 10000;

const surfaces = new Set<BaseWindow>();

export const offscreen_origin = (displays: Pick<Rectangle, "x" | "y">[]) => ({
  x: Math.min(0, ...displays.map((display) => display.x)) - offscreen_gap_px,
  y: Math.min(0, ...displays.map((display) => display.y)),
});

const origin = () => offscreen_origin(screen.getAllDisplays().map((display) => display.bounds));

export const create_surface = (size: TabSize): BaseWindow => {
  const surface = new BaseWindow({
    ...origin(),
    ...size,
    useContentSize: true,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    type: "toolbar",
    hasShadow: false,
  });
  surface.setOpacity(0);
  surface.setIgnoreMouseEvents(true);
  surfaces.add(surface);
  surface.once("closed", () => surfaces.delete(surface));
  return surface;
};

export const destroy_surface = (surface: BaseWindow) => {
  surfaces.delete(surface);
  if (!surface.isDestroyed()) {
    surface.destroy();
  }
};

const keep_offscreen = () => {
  const target = origin();
  for (const surface of surfaces) {
    if (surface.isDestroyed()) {
      continue;
    }
    const [width, height] = surface.getContentSize();
    surface.setContentBounds({ ...target, width, height });
  }
};

export const init_surfaces = () => {
  screen.on("display-added", keep_offscreen);
  screen.on("display-removed", keep_offscreen);
  screen.on("display-metrics-changed", keep_offscreen);
};

export const shutdown_surfaces = () => {
  screen.off("display-added", keep_offscreen);
  screen.off("display-removed", keep_offscreen);
  screen.off("display-metrics-changed", keep_offscreen);
};
