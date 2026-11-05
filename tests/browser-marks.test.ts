import assert from "node:assert/strict";
import { test } from "node:test";
import { draw_marks, tag_origin, tag_width } from "../electron/browser/marks.ts";

const canvas = (width: number, height: number) => Buffer.alloc(width * height * 4, 0x40);

const pixel = (bitmap: Buffer, width: number, x: number, y: number) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

const magenta = [255, 0, 255, 255];

const white = [255, 255, 255, 255];

test("tags are 18 px tall with 12 px per glyph and 2 px padding", () => {
  assert.equal(tag_width("b1"), 26);
  assert.equal(tag_width("b12"), 38);
});

test("a tall box gets its tag inside the top-right corner, a short one above it", () => {
  assert.deepEqual(tag_origin({ left: 100, top: 100, right: 300, bottom: 140 }, "b1", 800, 600), { x: 274, y: 100 });
  assert.deepEqual(tag_origin({ left: 100, top: 100, right: 300, bottom: 120 }, "b1", 800, 600), { x: 276, y: 80 });
});

test("tags are clamped into the image at the edges", () => {
  assert.deepEqual(tag_origin({ left: 0, top: 5, right: 10, bottom: 15 }, "b1", 800, 600), { x: 0, y: 5 });
  assert.deepEqual(tag_origin({ left: 780, top: 590, right: 800, bottom: 600 }, "b12", 800, 600), { x: 762, y: 570 });
});

test("the outline sits 2 px outside the box and the tag carries white glyphs on magenta", () => {
  const width = 200;
  const height = 120;
  const bitmap = canvas(width, height);
  draw_marks(bitmap, width, height, [{ label: "b1", box: { left: 40, top: 40, right: 160, bottom: 80 } }]);
  assert.deepEqual(pixel(bitmap, width, 38, 60), magenta);
  assert.deepEqual(pixel(bitmap, width, 39, 60), magenta);
  assert.deepEqual(pixel(bitmap, width, 40, 60), [0x40, 0x40, 0x40, 0x40]);
  assert.deepEqual(pixel(bitmap, width, 100, 81), magenta);
  const tag = tag_origin({ left: 40, top: 40, right: 160, bottom: 80 }, "b1", width, height);
  assert.deepEqual(pixel(bitmap, width, tag.x, tag.y), magenta);
  assert.deepEqual(pixel(bitmap, width, tag.x + 2, tag.y + 2), white);
  assert.deepEqual(pixel(bitmap, width, tag.x + 4, tag.y + 2), magenta);
});

test("magenta and white survive a red and blue channel swap", () => {
  for (const color of [magenta, white]) {
    assert.deepEqual([color[2], color[1], color[0], color[3]], color);
  }
});

test("a bitmap of the wrong size is refused", () => {
  assert.throws(() => draw_marks(Buffer.alloc(10), 4, 4, []), /Unexpected screenshot bitmap size/);
});
