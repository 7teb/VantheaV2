import { fit_image } from "../../shared/image-fit.ts";
import { largest_native } from "../../shared/image-native.ts";

const scaled_png = async (bitmap: ImageBitmap): Promise<Uint8Array> => {
  const size = fit_image(bitmap.width, bitmap.height, [largest_native]);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("no 2d canvas context");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
};

export const model_source = async (file: File): Promise<Uint8Array | null> => {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return await scaled_png(bitmap);
  } catch (error) {
    console.error(`[composer] decoding ${file.name} (${file.type}, ${file.size} bytes) for its model copy failed, the original goes to the model`, error);
    return null;
  } finally {
    bitmap?.close();
  }
};
