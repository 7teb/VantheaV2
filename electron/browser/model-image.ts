import { nativeImage, type NativeImage } from "electron";
import { fit_image, type NativeSize, type Size } from "../../shared/image-fit.ts";

export type ModelCopy = { bytes: Buffer; ext: "jpg" | "png"; size: Size };

export const jpeg_quality = 90;

const resized = (image: NativeImage, target: Size): NativeImage => {
  const size = image.getSize();
  return target.width === size.width && target.height === size.height ? image : image.resize({ width: target.width, height: target.height, quality: "best" });
};

export const fit_native = (image: NativeImage, rules: NativeSize[]): NativeImage => {
  const size = image.getSize();
  return resized(image, fit_image(size.width, size.height, rules));
};

export const model_jpeg = (image: NativeImage, rules: NativeSize[]): Buffer => fit_native(image, rules).toJPEG(jpeg_quality);

const has_alpha = (image: NativeImage): boolean => {
  const pixels = image.toBitmap();
  for (let at = 3; at < pixels.length; at += 4) {
    if (pixels[at] !== 255) {
      return true;
    }
  }
  return false;
};

const encoded = (image: NativeImage): ModelCopy => {
  const size = image.getSize();
  return has_alpha(image) ? { bytes: image.toPNG(), ext: "png", size } : { bytes: image.toJPEG(jpeg_quality), ext: "jpg", size };
};

export const model_copy = (image: NativeImage, rules: NativeSize[]): ModelCopy => encoded(fit_native(image, rules));

export const decode_image = (bytes: Buffer): NativeImage | null => {
  const image = nativeImage.createFromBuffer(bytes);
  return image.isEmpty() ? null : image;
};

export const resized_copy = (bytes: Buffer, target: Size): ModelCopy => {
  const image = decode_image(bytes);
  if (!image) {
    throw new Error(`a stored ${bytes.length}-byte image could not be decoded for resizing to ${target.width}x${target.height}`);
  }
  return encoded(resized(image, target));
};
