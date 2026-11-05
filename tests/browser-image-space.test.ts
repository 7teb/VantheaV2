import assert from "node:assert/strict";
import { test } from "node:test";
import { aspect_matches, box_to_image, image_square, point_to_css } from "../electron/browser/image-space.ts";
import { default_native, edge_rule, fit_image, type NativeSize } from "../shared/image-fit.ts";
import { native_size } from "../shared/image-native.ts";

const claude = native_size("anthropic/claude-opus-5.5");

const claude_standard: NativeSize = { max_edge: 1568, patch: 28, max_patches: 1568 };

test("the default fit stays inside 1440 px and 1,296,000 pixels and never upscales", () => {
  assert.deepEqual(fit_image(1000, 800, [default_native]), { width: 1000, height: 800 });
  assert.deepEqual(fit_image(1500, 1200, [default_native]), { width: 1273, height: 1018 });
  assert.deepEqual(fit_image(2560, 1440, [default_native]), { width: 1440, height: 810 });
  assert.deepEqual(fit_image(1440, 1100, [default_native]), { width: 1302, height: 995 });
  assert.deepEqual(fit_image(390, 844, [default_native]), { width: 390, height: 844 });
});

test("the patch fit reproduces the sizes the Claude vision docs list for both tiers", () => {
  assert.deepEqual(fit_image(1920, 1080, [claude_standard]), { width: 1456, height: 819 });
  assert.deepEqual(fit_image(1075, 1520, [claude_standard]), { width: 924, height: 1307 });
  assert.deepEqual(fit_image(3840, 2160, [claude]), { width: 2576, height: 1449 });
  assert.deepEqual(fit_image(1920, 1080, [claude]), { width: 1920, height: 1080 });
  assert.deepEqual(fit_image(2000, 1500, [claude]), { width: 2000, height: 1500 });
  assert.deepEqual(fit_image(1075, 1520, [claude]), { width: 1075, height: 1520 });
});

test("several rules fit the strictest of them", () => {
  assert.deepEqual(fit_image(3840, 2160, [claude, default_native]), { width: 1440, height: 810 });
});

test("a HiDPI screenshot fitted for Claude maps refs and clicks back onto the same CSS pixels as the default fit", () => {
  const capture = { width: 2560, height: 1600 };
  const viewport = { width: 1280, height: 800 };
  const button = { left: 600, top: 380, right: 680, bottom: 420 };
  for (const rules of [[claude], [default_native]]) {
    const image = fit_image(capture.width, capture.height, rules);
    assert.ok(aspect_matches(image, viewport));
    const box = box_to_image(button, viewport, image);
    const center = { x: Math.round((box.left + box.right) / 2), y: Math.round((box.top + box.bottom) / 2) };
    const css = point_to_css(center, image, viewport);
    assert.ok(css.x > button.left && css.x < button.right, `${image.width}: x ${css.x}`);
    assert.ok(css.y > button.top && css.y < button.bottom, `${image.width}: y ${css.y}`);
    assert.ok(Math.abs(css.x - 640) <= 1 && Math.abs(css.y - 400) <= 1, `${image.width}: ${css.x},${css.y}`);
    const crop = box_to_image(image_square(center, 48, image), image, capture);
    assert.ok(crop.left < 1280 && crop.right > 1280 && crop.top < 800 && crop.bottom > 800, `${image.width}: crop ${JSON.stringify(crop)}`);
  }
  assert.deepEqual(fit_image(capture.width, capture.height, [claude]), { width: 2420, height: 1512 });
});

test("an image point maps back onto the CSS viewport within one CSS pixel", () => {
  const image = { width: 1273, height: 1018 };
  const viewport = { width: 1000, height: 800 };
  for (const [x, y] of [
    [0, 0],
    [636, 509],
    [1272, 1017],
  ] as const) {
    const css = point_to_css({ x, y }, image, viewport);
    assert.ok(Math.abs(css.x - (x / image.width) * viewport.width) <= 1, `${x}`);
    assert.ok(Math.abs(css.y - (y / image.height) * viewport.height) <= 1, `${y}`);
    assert.ok(css.x < viewport.width && css.y < viewport.height);
  }
});

test("CSS boxes scale onto the image and stay inside it", () => {
  assert.deepEqual(box_to_image({ left: 10, top: 20, right: 110, bottom: 60 }, { width: 1000, height: 800 }, { width: 1273, height: 1018 }), { left: 12, top: 25, right: 141, bottom: 77 });
  assert.deepEqual(box_to_image({ left: -5, top: 790, right: 1005, bottom: 820 }, { width: 1000, height: 800 }, { width: 1000, height: 800 }), { left: 0, top: 790, right: 1000, bottom: 800 });
});

test("the staleness square is clamped to the image", () => {
  assert.deepEqual(image_square({ x: 10, y: 500 }, 48, { width: 1000, height: 800 }), { left: 0, top: 476, right: 34, bottom: 524 });
  assert.deepEqual(image_square({ x: 999, y: 799 }, 48, { width: 1000, height: 800 }), { left: 975, top: 775, right: 1000, bottom: 800 });
});

test("aspect ratios more than one percent apart do not match", () => {
  assert.equal(aspect_matches({ width: 1500, height: 1200 }, { width: 1000, height: 800 }), true);
  assert.equal(aspect_matches({ width: 1500, height: 1200 }, { width: 1000, height: 780 }), false);
  assert.equal(aspect_matches({ width: 1001, height: 800 }, { width: 1000, height: 800 }), true);
});

test("a Claude screenshot taken as the 21st image of a request is fitted to 2000 px and its clicks map back onto the same CSS pixels", () => {
  const capture = { width: 2560, height: 1600 };
  const viewport = { width: 1280, height: 800 };
  const many = [claude, edge_rule(2000)];
  const image = fit_image(capture.width, capture.height, many);
  assert.deepEqual(image, { width: 2000, height: 1250 });
  const box = box_to_image({ left: 600, top: 380, right: 680, bottom: 420 }, viewport, image);
  const center = { x: Math.round((box.left + box.right) / 2), y: Math.round((box.top + box.bottom) / 2) };
  const css = point_to_css(center, image, viewport);
  assert.ok(Math.abs(css.x - 640) <= 1 && Math.abs(css.y - 400) <= 1, `${css.x},${css.y}`);
});
