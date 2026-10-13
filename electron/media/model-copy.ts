import { nativeImage } from "electron";
import type { Attachment } from "../../shared/chat.ts";
import { largest_native } from "../../shared/image-native.ts";
import { attachment_limits } from "../../shared/ipc/media.ts";
import { model_copy } from "../browser/model-image.ts";
import { delete_attachment, new_media_id, sniff_image, write_media } from "./files.ts";

const write_model_copy = async (source: Uint8Array, original: Attachment): Promise<Attachment> => {
  if (sniff_image(source)?.ext !== "png") {
    throw new Error("The model copy is not a PNG image");
  }
  if (source.length > attachment_limits.image_bytes) {
    throw new Error("The model copy exceeds the 20 MB limit");
  }
  const image = nativeImage.createFromBuffer(Buffer.from(source.buffer, source.byteOffset, source.byteLength));
  if (image.isEmpty()) {
    throw new Error("The model copy could not be decoded");
  }
  const copy = model_copy(image, [largest_native]);
  const id = new_media_id("img", copy.ext);
  await write_media("attachment", id, copy.bytes);
  return { ...original, model: { id, width: copy.size.width, height: copy.size.height } };
};

export const save_model_copy = async (source: Uint8Array, original: Attachment): Promise<Attachment> => {
  try {
    return await write_model_copy(source, original);
  } catch (error) {
    console.error(`[media] the model copy of ${original.id} (${original.name}) failed, removing the original:`, error);
    await delete_attachment(original.id).catch((cleanup: unknown) => console.error(`[media] removing ${original.id} after a failed model copy failed:`, cleanup));
    throw error;
  }
};
