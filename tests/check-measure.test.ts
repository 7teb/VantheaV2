import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { analyze, motion } from "../electron/check/measure.ts";
import { decode_png } from "../electron/check/png.ts";
import { resize_bicubic } from "../electron/check/resample.ts";
import { fixture_images, fixtures, pillow } from "./check-images.ts";

const images = fixture_images();

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

test("the fixtures were computed with the Pillow version check.py ran on", () => {
  assert.equal(pillow.pillow, "12.3.0");
  assert.deepEqual(Object.keys(pillow.analyze).sort(), Object.keys(images).sort());
});

test("the bicubic shrink to 240 px wide is byte-identical to Pillow's Image.resize, downscale and upscale", () => {
  for (const [name, image] of Object.entries(images)) {
    const fixture = pillow.analyze[name];
    const height = Math.trunc((240 * image.height) / image.width);
    assert.deepEqual([240, height], fixture.small_size, name);
    assert.equal(sha256(resize_bicubic(image.data, image.width, image.height, 3, 240, height)), fixture.small_sha256, name);
  }
});

test("a resize to the same size is a copy", () => {
  const data = images.checker.data;
  const copy = resize_bicubic(data, 97, 61, 3, 97, 61);
  assert.deepEqual(copy, data);
  assert.notEqual(copy, data);
});

test("analyze gives Pillow's modal share, distinct colors and mean FIND_EDGES value exactly", () => {
  for (const [name, image] of Object.entries(images)) {
    const fixture = pillow.analyze[name];
    const result = analyze(image);
    assert.equal(result.modal, fixture.top / fixture.pixels, name);
    assert.equal(result.modal, fixture.modal, name);
    assert.equal(result.colors, fixture.colors, name);
    assert.equal(result.edges, fixture.edges, name);
  }
});

test("motion counts the same changed pixels as Pillow's difference, L conversion and 200x120 resize, also for different sizes", () => {
  assert.equal(Object.keys(pillow.motion).length, 5);
  for (const [pair, fixture] of Object.entries(pillow.motion)) {
    const [first, second] = pair.split("|");
    assert.equal(motion(images[first], images[second]), fixture.value, pair);
    assert.equal(Math.round(fixture.value * 24000), fixture.changed, pair);
  }
});

test("Pillow-written RGB and RGBA PNGs decode to the generator's pixels, alpha dropped like convert('RGB')", () => {
  for (const file of ["checker_rgb.png", "checker_rgba.png"]) {
    const decoded = decode_png(fs.readFileSync(path.join(fixtures, file)));
    assert.equal(decoded.width, 97, file);
    assert.equal(decoded.height, 61, file);
    assert.deepEqual(decoded.data, images.checker.data, file);
  }
});
