import type { Size } from "../../shared/image-fit.ts";
import type { Box } from "./state.ts";

export type Point = { x: number; y: number };

export const aspect_matches = (left: Size, right: Size): boolean => Math.abs(left.width / left.height - right.width / right.height) <= (right.width / right.height) * 0.01;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export const box_to_image = (box: Box, from: Size, image: Size): Box => {
  const scale_x = image.width / from.width;
  const scale_y = image.height / from.height;
  return {
    left: clamp(Math.floor(box.left * scale_x), 0, image.width),
    top: clamp(Math.floor(box.top * scale_y), 0, image.height),
    right: clamp(Math.ceil(box.right * scale_x), 0, image.width),
    bottom: clamp(Math.ceil(box.bottom * scale_y), 0, image.height),
  };
};

export const point_to_css = (point: Point, image: Size, viewport: Size): Point => ({
  x: ((point.x + 0.5) / image.width) * viewport.width,
  y: ((point.y + 0.5) / image.height) * viewport.height,
});

export const image_square = (point: Point, side: number, image: Size): Box => {
  const half = side / 2;
  return {
    left: clamp(Math.round(point.x - half), 0, image.width - 1),
    top: clamp(Math.round(point.y - half), 0, image.height - 1),
    right: clamp(Math.round(point.x + half), 1, image.width),
    bottom: clamp(Math.round(point.y + half), 1, image.height),
  };
};
