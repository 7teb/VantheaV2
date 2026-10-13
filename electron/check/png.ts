import { inflateSync } from "node:zlib";

export type RgbImage = { width: number; height: number; data: Uint8Array };

const signature = [137, 80, 78, 71, 13, 10, 26, 10];

const paeth = (left: number, up: number, corner: number): number => {
  const estimate = left + up - corner;
  const to_left = Math.abs(estimate - left);
  const to_up = Math.abs(estimate - up);
  const to_corner = Math.abs(estimate - corner);
  if (to_left <= to_up && to_left <= to_corner) {
    return left;
  }
  return to_up <= to_corner ? up : corner;
};

const predict = (filter: number, left: number, up: number, corner: number): number => {
  if (filter === 0) {
    return 0;
  }
  if (filter === 1) {
    return left;
  }
  if (filter === 2) {
    return up;
  }
  if (filter === 3) {
    return (left + up) >> 1;
  }
  if (filter === 4) {
    return paeth(left, up, corner);
  }
  throw new Error(`PNG row uses unknown filter type ${filter}`);
};

type Header = { width: number; height: number; channels: number };

const read_header = (body: Buffer): Header => {
  const depth = body[8];
  const color = body[9];
  const interlace = body[12];
  const channels = color === 2 ? 3 : color === 6 ? 4 : 0;
  if (depth !== 8 || !channels || interlace !== 0) {
    throw new Error(`unsupported PNG layout (bit depth ${depth}, color type ${color}, interlace ${interlace})`);
  }
  return { width: body.readUInt32BE(0), height: body.readUInt32BE(4), channels };
};

const unfilter = (raw: Buffer, header: Header): Uint8Array => {
  const { width, height, channels } = header;
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) {
    throw new Error("PNG image data is truncated");
  }
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y ? pixels[row - stride + x] : 0;
      const corner = y && x >= channels ? pixels[row - stride + x - channels] : 0;
      pixels[row + x] = (raw[source + x] + predict(filter, left, up, corner)) & 255;
    }
  }
  return pixels;
};

const to_rgb = (pixels: Uint8Array, header: Header): Uint8Array => {
  if (header.channels === 3) {
    return pixels;
  }
  const count = header.width * header.height;
  const rgb = new Uint8Array(count * 3);
  for (let at = 0; at < count; at += 1) {
    rgb[at * 3] = pixels[at * 4];
    rgb[at * 3 + 1] = pixels[at * 4 + 1];
    rgb[at * 3 + 2] = pixels[at * 4 + 2];
  }
  return rgb;
};

export const decode_png = (bytes: Buffer): RgbImage => {
  if (bytes.length < 8 || signature.some((value, at) => bytes[at] !== value)) {
    throw new Error("not a PNG file");
  }
  let header: Header | null = null;
  const parts: Buffer[] = [];
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      header = read_header(body);
    } else if (type === "IDAT") {
      parts.push(body);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!header || !parts.length) {
    throw new Error("PNG has no header or no image data");
  }
  return { width: header.width, height: header.height, data: to_rgb(unfilter(inflateSync(Buffer.concat(parts)), header), header) };
};
