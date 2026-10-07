import { nativeImage } from "electron";

const max_reference_pixels = 40_000_000;

const max_reference_bytes = 4 * 1024 * 1024;

const max_reference_edge = 2000;

export const reference_data_url = (bytes: Buffer, mime: string): string => {
  if (mime !== "image/png" && mime !== "image/jpeg") {
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
  const image = nativeImage.createFromBuffer(bytes);
  const { width, height } = image.getSize();
  if (image.isEmpty() || (width * height <= max_reference_pixels && bytes.length <= max_reference_bytes)) {
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
  const scale = Math.min(1, max_reference_edge / Math.max(width, height));
  const scaled = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : image;
  return `data:image/jpeg;base64,${scaled.toJPEG(80).toString("base64")}`;
};

export const image_size = (bytes: Buffer): { width: number | null; height: number | null } => {
  const { width, height } = nativeImage.createFromBuffer(bytes).getSize();
  return width && height ? { width, height } : { width: null, height: null };
};
