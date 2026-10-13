const precision_bits = 22;

const support_radius = 2;

type Coefficients = { size: number; bounds: Int32Array; weights: Int32Array };

const bicubic = (value: number): number => {
  const a = -0.5;
  const x = value < 0 ? -value : value;
  if (x < 1) {
    return ((a + 2.0) * x - (a + 3.0)) * x * x + 1;
  }
  if (x < 2) {
    return (((x - 5) * x + 8) * x - 4) * a;
  }
  return 0;
};

const fixed_point = (weight: number): number => (weight < 0 ? Math.trunc(-0.5 + weight * (1 << precision_bits)) : Math.trunc(0.5 + weight * (1 << precision_bits)));

const coefficients = (in_size: number, out_size: number): Coefficients => {
  const scale = in_size / out_size;
  const filter_scale = scale < 1 ? 1 : scale;
  const support = support_radius * filter_scale;
  const size = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(out_size * 2);
  const weights = new Int32Array(out_size * size);
  const kernel = new Float64Array(size);
  const step = 1 / filter_scale;
  for (let out = 0; out < out_size; out += 1) {
    const center = (out + 0.5) * scale;
    const low = Math.max(0, Math.trunc(center - support + 0.5));
    const count = Math.min(in_size, Math.trunc(center + support + 0.5)) - low;
    let total = 0;
    for (let at = 0; at < count; at += 1) {
      const weight = bicubic((at + low - center + 0.5) * step);
      kernel[at] = weight;
      total += weight;
    }
    for (let at = 0; at < count; at += 1) {
      weights[out * size + at] = fixed_point(total !== 0 ? kernel[at] / total : kernel[at]);
    }
    bounds[out * 2] = low;
    bounds[out * 2 + 1] = count;
  }
  return { size, bounds, weights };
};

const clip8 = (sum: number): number => {
  const value = sum >> precision_bits;
  return value < 0 ? 0 : value > 255 ? 255 : value;
};

const horizontal = (data: Uint8Array, width: number, channels: number, first_row: number, rows: number, out_width: number, coeffs: Coefficients): Uint8Array => {
  const out = new Uint8Array(out_width * rows * channels);
  for (let y = 0; y < rows; y += 1) {
    const row = (y + first_row) * width;
    for (let x = 0; x < out_width; x += 1) {
      const low = coeffs.bounds[x * 2];
      const count = coeffs.bounds[x * 2 + 1];
      const base = x * coeffs.size;
      for (let channel = 0; channel < channels; channel += 1) {
        let sum = 1 << (precision_bits - 1);
        for (let at = 0; at < count; at += 1) {
          sum += data[(row + low + at) * channels + channel] * coeffs.weights[base + at];
        }
        out[(y * out_width + x) * channels + channel] = clip8(sum);
      }
    }
  }
  return out;
};

const vertical = (data: Uint8Array, width: number, channels: number, out_height: number, coeffs: Coefficients, first_row: number): Uint8Array => {
  const out = new Uint8Array(width * out_height * channels);
  const stride = width * channels;
  for (let y = 0; y < out_height; y += 1) {
    const low = coeffs.bounds[y * 2] - first_row;
    const count = coeffs.bounds[y * 2 + 1];
    const base = y * coeffs.size;
    for (let x = 0; x < stride; x += 1) {
      let sum = 1 << (precision_bits - 1);
      for (let at = 0; at < count; at += 1) {
        sum += data[(low + at) * stride + x] * coeffs.weights[base + at];
      }
      out[y * stride + x] = clip8(sum);
    }
  }
  return out;
};

export const resize_bicubic = (data: Uint8Array, width: number, height: number, channels: number, out_width: number, out_height: number): Uint8Array => {
  if (width === out_width && height === out_height) {
    return data.slice();
  }
  const across = coefficients(width, out_width);
  const down = coefficients(height, out_height);
  const first_row = down.bounds[0];
  const last_row = down.bounds[out_height * 2 - 2] + down.bounds[out_height * 2 - 1];
  const rows = width === out_width ? data : horizontal(data, width, channels, first_row, last_row - first_row, out_width, across);
  const row_offset = width === out_width ? 0 : first_row;
  return height === out_height ? rows : vertical(rows, out_width, channels, out_height, down, row_offset);
};
