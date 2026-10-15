import type { BrowserRect } from "../../../../shared/ipc/browser.ts";

type Box = { left: number; top: number; width: number; height: number };

export const rect_of = (box: Box): BrowserRect => ({ x: box.left, y: box.top, width: box.width, height: box.height });

export const has_area = (rect: BrowserRect) => rect.width >= 1 && rect.height >= 1;

export const intersects = (a: BrowserRect, b: BrowserRect) =>
  has_area(a) && has_area(b) && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const covered_by = (viewport: BrowserRect, overlays: BrowserRect[]) => overlays.some((overlay) => intersects(viewport, overlay));

export const same_rect = (a: BrowserRect | null, b: BrowserRect | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
