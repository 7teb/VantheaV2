import type { ImageModelEntry } from "../../../shared/models.ts";
import type { Settings } from "../../../shared/settings.ts";
import { classify_provider_error, ModelError, read_provider_error } from "../../model/errors.ts";
import { as_array, as_record, as_string } from "../../storage/coerce.ts";

export type ImageReference = { type: "image_url"; image_url: { url: string } };

export type ImageRequest = {
  model: string;
  prompt: string;
  n: number;
  quality?: Exclude<Settings["image_gen"]["quality"], "auto">;
  input_references?: ImageReference[];
};

export type DecodedImage = { bytes: Buffer; mime: string };

export type ImageBodyOptions = { model: ImageModelEntry; prompt: string; quality: Settings["image_gen"]["quality"]; references: string[] };

export const image_body = (options: ImageBodyOptions): ImageRequest => ({
  model: options.model.id,
  prompt: options.prompt,
  n: 1,
  ...(options.model.quality && options.quality !== "auto" ? { quality: options.quality } : {}),
  ...(options.references.length ? { input_references: options.references.map((url) => ({ type: "image_url" as const, image_url: { url } })) } : {}),
});

export const parse_image_response = (text: string): DecodedImage[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn(`[image] response body is not JSON (${String(error)}): ${text.slice(0, 200)}`);
    throw new ModelError("internal", "OpenRouter returned an unreadable image response.");
  }
  const body = as_record(parsed);
  const error = read_provider_error(body.error);
  if (error) {
    throw classify_provider_error(null, error, "");
  }
  return as_array(body.data).flatMap((entry) => {
    const raw = as_record(entry);
    const b64 = as_string(raw.b64_json);
    if (!b64) {
      return [];
    }
    return [{ bytes: Buffer.from(b64, "base64"), mime: as_string(raw.media_type) || "image/png" }];
  });
};

export const accepts_image_input = (models: unknown, model_id: string): boolean | null => {
  const entry = as_array(as_record(models).data).find((item) => as_record(item).id === model_id);
  if (!entry) {
    return null;
  }
  return as_array(as_record(as_record(entry).architecture).input_modalities).includes("image");
};
