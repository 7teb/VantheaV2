import fs from "node:fs";
import path from "node:path";
import type { RgbImage } from "../electron/check/png.ts";

export type AnalyzeFixture = { small_size: [number, number]; small_sha256: string; top: number; pixels: number; modal: number; colors: number; edges: number; modal_2f: string; edges_1f: string };

export type MotionFixture = { changed: number; value: number; value_3f: string };

export const fixtures = path.join(import.meta.dirname, "fixtures", "check");

export const pillow = JSON.parse(fs.readFileSync(path.join(fixtures, "measure.json"), "utf8")) as { pillow: string; analyze: Record<string, AnalyzeFixture>; motion: Record<string, MotionFixture> };

const xorshift = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state;
  };
};

export const paint = (width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): RgbImage => {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixel(x, y), (y * width + x) * 3);
    }
  }
  return { width, height, data };
};

export const scene = (width: number, height: number, shift: number) =>
  paint(width, height, (x, y) => {
    if ((x + y + shift) % 97 < 3) {
      return [255, 255, 255];
    }
    if (shift <= x - 300 && x - 300 < shift + 220 && y >= 400 && y < 640) {
      return [240, 200 - (x % 50), 30];
    }
    return [Math.floor((x * 255) / (width - 1)), Math.floor((y * 255) / (height - 1)), ((Math.floor(x / 16) ^ Math.floor(y / 16)) * 37) & 255];
  });

export const flat = (width: number, height: number) => paint(width, height, (x, y) => (x >= 50 && x < 150 && y >= 50 && y < 110 ? [200, 40, 90] : [12, 14, 20]));

const random_bytes = (width: number, height: number, seed: number, value: (next: number) => number): RgbImage => {
  const next = xorshift(seed);
  const data = new Uint8Array(width * height * 3);
  for (let at = 0; at < data.length; at += 1) {
    data[at] = value(next());
  }
  return { width, height, data };
};

export const noise = (width: number, height: number, seed: number) => random_bytes(width, height, seed, (value) => value >>> 24);

export const dark = (width: number, height: number, seed: number) => random_bytes(width, height, seed, (value) => 8 + (value & 3));

export const checker = (width: number, height: number) => paint(width, height, (x, y) => ((Math.floor(x / 7) + Math.floor(y / 7)) % 2 ? [250, 10, 10] : [5, 5, 120]));

export const fixture_images = (): Record<string, RgbImage> => ({
  scene_a: scene(1440, 1100, 0),
  scene_b: scene(1440, 1100, 40),
  flat: flat(800, 1100),
  noise: noise(390, 844, 2463534242),
  dark: dark(1440, 1100, 88172645),
  checker: checker(97, 61),
});
