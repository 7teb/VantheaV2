import fs from "node:fs/promises";
import path from "node:path";
import { error_code, error_text } from "../storage/coerce.ts";
import { is_media_id, media_exists, media_path, type MediaBucket } from "./files.ts";

export type LegacyMediaRef = { bucket: MediaBucket; name: string };

const legacy_source = (legacy_root: string, name: string) =>
  path.join(legacy_root, name.startsWith("att_") ? "files" : "images", name);

const link_or_copy = async (source: string, ref: LegacyMediaRef): Promise<boolean> => {
  const target = media_path(ref.bucket, ref.name);
  if (await media_exists(ref.bucket, ref.name)) {
    return true;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.link(source, target);
    return true;
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      console.error(`[media] legacy file ${source} is missing, the ${ref.bucket} ${ref.name} stays unresolved`);
      return false;
    }
    console.warn(`[media] hard-linking legacy ${source} failed (${error_text(error)}), copying it instead`);
  }
  await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  return true;
};

export const import_legacy_media = async (legacy_root: string, ref: LegacyMediaRef): Promise<boolean> => {
  if (!is_media_id(ref.name)) {
    console.error(`[media] legacy media name ${JSON.stringify(ref.name).slice(0, 80)} is not a valid media id, skipped`);
    return false;
  }
  const source = legacy_source(legacy_root, ref.name);
  try {
    return await link_or_copy(source, ref);
  } catch (error) {
    console.error(`[media] importing legacy ${source} as ${ref.bucket} ${ref.name} failed, the reference stays unresolved:`, error);
    return false;
  }
};
