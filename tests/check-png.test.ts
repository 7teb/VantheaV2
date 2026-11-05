import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { decode_png } from "../electron/check/png.ts";

const chunk = (type: string, body: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), body, Buffer.alloc(4)]);
};

const header = (width: number, height: number, depth: number, color: number, interlace = 0) => {
  const body = Buffer.alloc(13);
  body.writeUInt32BE(width, 0);
  body.writeUInt32BE(height, 4);
  body[8] = depth;
  body[9] = color;
  body[12] = interlace;
  return chunk("IHDR", body);
};

const paeth = (left: number, up: number, corner: number) => {
  const estimate = left + up - corner;
  const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - corner)];
  return a <= b && a <= c ? left : b <= c ? up : corner;
};

const filtered_rows = (pixels: Uint8Array, width: number, height: number, channels: number, filters: number[]) => {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const filter = filters[y % filters.length];
    out[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x += 1) {
      const value = pixels[y * stride + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter];
      out[y * (stride + 1) + 1 + x] = (value - predicted) & 255;
    }
  }
  return out;
};

const encode = (pixels: Uint8Array, width: number, height: number, channels: number, filters: number[]) => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const data = deflateSync(filtered_rows(pixels, width, height, channels, filters));
  return Buffer.concat([signature, header(width, height, 8, channels === 3 ? 2 : 6), chunk("tEXt", Buffer.from("Comment\0x")), chunk("IDAT", data.subarray(0, 7)), chunk("IDAT", data.subarray(7)), chunk("IEND", Buffer.alloc(0))]);
};

const pattern = (width: number, height: number, channels: number) => {
  const pixels = new Uint8Array(width * height * channels);
  for (let at = 0; at < pixels.length; at += 1) {
    pixels[at] = (at * 37 + Math.floor(at / 7) * 11 + (at % 5) * 101) & 255;
  }
  return pixels;
};

const rgb_of = (pixels: Uint8Array, channels: number) => {
  const count = pixels.length / channels;
  const rgb = new Uint8Array(count * 3);
  for (let at = 0; at < count; at += 1) {
    rgb.set(pixels.subarray(at * channels, at * channels + 3), at * 3);
  }
  return rgb;
};

test("RGB and RGBA rows with each of the five filter types decode exactly, IDAT split across chunks", () => {
  for (const channels of [3, 4]) {
    for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
      const pixels = pattern(13, 9, channels);
      const decoded = decode_png(encode(pixels, 13, 9, channels, filters));
      assert.equal(decoded.width, 13);
      assert.equal(decoded.height, 9);
      assert.deepEqual(decoded.data, rgb_of(pixels, channels), `${channels} channels, filters ${filters.join(",")}`);
    }
  }
});

test("layouts other than 8-bit RGB or RGBA without interlace throw instead of measuring wrong pixels", () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = chunk("IDAT", deflateSync(Buffer.alloc(10)));
  for (const [depth, color, interlace] of [
    [16, 2, 0],
    [8, 3, 0],
    [8, 0, 0],
    [8, 4, 0],
    [8, 2, 1],
  ]) {
    assert.throws(() => decode_png(Buffer.concat([signature, header(2, 2, depth, color, interlace), idat])), /unsupported PNG layout/);
  }
  assert.throws(() => decode_png(Buffer.from("GIF89a....")), /not a PNG file/);
  assert.throws(() => decode_png(Buffer.concat([signature, header(2, 2, 8, 2), chunk("IEND", Buffer.alloc(0))])), /no header or no image data/);
});

test("an unknown filter type and truncated image data throw", () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const bad_filter = Buffer.from([5, 1, 2, 3]);
  assert.throws(() => decode_png(Buffer.concat([signature, header(1, 1, 8, 2), chunk("IDAT", deflateSync(bad_filter))])), /unknown filter type 5/);
  assert.throws(() => decode_png(Buffer.concat([signature, header(4, 4, 8, 2), chunk("IDAT", deflateSync(Buffer.alloc(5)))])), /truncated/);
});
