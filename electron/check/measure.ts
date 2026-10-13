import type { RgbImage } from "./png.ts";
import { resize_bicubic } from "./resample.ts";

export type Analysis = { modal: number; colors: number; edges: number };

const luma = (red: number, green: number, blue: number): number => (red * 19595 + green * 38470 + blue * 7471 + 0x8000) >> 16;

const to_luma = (rgb: Uint8Array, pixels: number): Uint8Array => {
  const out = new Uint8Array(pixels);
  for (let at = 0; at < pixels; at += 1) {
    out[at] = luma(rgb[at * 3], rgb[at * 3 + 1], rgb[at * 3 + 2]);
  }
  return out;
};

const find_edges = (gray: Uint8Array, width: number, height: number): Uint8Array => {
  const out = gray.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let sum = 8 * gray[y * width + x];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx || dy) {
            sum -= gray[(y + dy) * width + x + dx];
          }
        }
      }
      out[y * width + x] = sum <= 0 ? 0 : sum >= 255 ? 255 : sum;
    }
  }
  return out;
};

const mean = (values: Uint8Array): number => {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
};

const shrink = (image: RgbImage): RgbImage => {
  const height = Math.trunc((240 * image.height) / image.width);
  return { width: 240, height, data: resize_bicubic(image.data, image.width, image.height, 3, 240, height) };
};

const edge_map = (small: RgbImage): Uint8Array => find_edges(to_luma(small.data, small.width * small.height), small.width, small.height);

export const analyze = (image: RgbImage): Analysis => {
  const small = shrink(image);
  const counts = new Uint32Array(4096);
  const pixels = small.width * small.height;
  for (let at = 0; at < pixels; at += 1) {
    counts[((small.data[at * 3] >> 4) << 8) | ((small.data[at * 3 + 1] >> 4) << 4) | (small.data[at * 3 + 2] >> 4)] += 1;
  }
  let top = 0;
  let colors = 0;
  for (const count of counts) {
    top = Math.max(top, count);
    colors += count ? 1 : 0;
  }
  return { modal: top / pixels, colors, edges: mean(edge_map(small)) };
};

const difference_map = (first: RgbImage, second: RgbImage): Uint8Array => {
  const width = Math.min(first.width, second.width);
  const height = Math.min(first.height, second.height);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = (y * first.width + x) * 3;
      const b = (y * second.width + x) * 3;
      gray[y * width + x] = luma(Math.abs(first.data[a] - second.data[b]), Math.abs(first.data[a + 1] - second.data[b + 1]), Math.abs(first.data[a + 2] - second.data[b + 2]));
    }
  }
  return resize_bicubic(gray, width, height, 1, 200, 120);
};

export const motion = (first: RgbImage, second: RgbImage): number => {
  const small = difference_map(first, second);
  let changed = 0;
  for (const value of small) {
    changed += value > 12 ? 1 : 0;
  }
  return changed / small.length;
};
