import type { Box } from "./state.ts";

export type Mark = { label: string; box: Box };

type Color = readonly [number, number, number];

const glyphs: Record<string, readonly string[]> = {
  b: ["10000", "10000", "11110", "10001", "10001", "10001", "11110"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

const magenta: Color = [255, 0, 255];

const white: Color = [255, 255, 255];

const glyph_scale = 2;

const glyph_advance = 12;

const tag_padding = 2;

const tag_height = 18;

const outline = 2;

const inside_min_height = 30;

export const tag_width = (label: string) => tag_padding * 2 + label.length * 5 * glyph_scale + (label.length - 1) * (glyph_advance - 5 * glyph_scale);

type Canvas = { bitmap: Buffer; width: number; height: number };

const fill = (canvas: Canvas, left: number, top: number, right: number, bottom: number, color: Color) => {
  for (let y = Math.max(0, top); y < Math.min(canvas.height, bottom); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(canvas.width, right); x += 1) {
      const at = (y * canvas.width + x) * 4;
      canvas.bitmap[at] = color[0];
      canvas.bitmap[at + 1] = color[1];
      canvas.bitmap[at + 2] = color[2];
      canvas.bitmap[at + 3] = 255;
    }
  }
};

export const tag_origin = (box: Box, label: string, width: number, height: number): { x: number; y: number } => {
  const tag = tag_width(label);
  const fits_inside = box.bottom - box.top >= inside_min_height && box.right - box.left >= tag + 4;
  const above = box.top - outline - tag_height;
  const raw = fits_inside || above < 0 ? { x: box.right - tag, y: box.top } : { x: box.right + outline - tag, y: above };
  return { x: Math.min(Math.max(0, raw.x), width - tag), y: Math.min(Math.max(0, raw.y), height - tag_height) };
};

const draw_label = (canvas: Canvas, label: string, origin: { x: number; y: number }) => {
  fill(canvas, origin.x, origin.y, origin.x + tag_width(label), origin.y + tag_height, magenta);
  let glyph_x = origin.x + tag_padding;
  for (const char of label) {
    const rows = glyphs[char] ?? [];
    for (const [row_index, row] of rows.entries()) {
      for (const [column, bit] of [...row].entries()) {
        if (bit !== "1") {
          continue;
        }
        const x = glyph_x + column * glyph_scale;
        const y = origin.y + tag_padding + row_index * glyph_scale;
        fill(canvas, x, y, x + glyph_scale, y + glyph_scale, white);
      }
    }
    glyph_x += glyph_advance;
  }
};

const draw_outline = (canvas: Canvas, box: Box) => {
  fill(canvas, box.left - outline, box.top - outline, box.right + outline, box.top, magenta);
  fill(canvas, box.left - outline, box.bottom, box.right + outline, box.bottom + outline, magenta);
  fill(canvas, box.left - outline, box.top, box.left, box.bottom, magenta);
  fill(canvas, box.right, box.top, box.right + outline, box.bottom, magenta);
};

export const draw_marks = (bitmap: Buffer, width: number, height: number, marks: Mark[]): void => {
  if (bitmap.length !== width * height * 4) {
    throw new Error("Unexpected screenshot bitmap size");
  }
  const canvas: Canvas = { bitmap, width, height };
  for (const mark of marks) {
    draw_outline(canvas, mark.box);
  }
  for (const mark of marks) {
    draw_label(canvas, mark.label, tag_origin(mark.box, mark.label, width, height));
  }
};
