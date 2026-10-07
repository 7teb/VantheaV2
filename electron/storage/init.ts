import { app } from "electron";
import path from "node:path";
import { init_chats } from "../chats/store.ts";
import { emit } from "../ipc/handle.ts";
import { init_artifacts } from "../media/artifacts.ts";
import { init_media } from "../media/files.ts";
import { register_media_protocol } from "../media/protocol.ts";
import { init_settings } from "../settings/store.ts";
import { sweep_tmp } from "./json-file.ts";
import { ensure_storage_dirs, set_storage_root, storage_dirs } from "./paths.ts";
import { safe_storage_codec } from "./secrets.ts";

export const init_persistence = async () => {
  let step = "storage directories";
  try {
    const paths = set_storage_root(path.join(app.getPath("appData"), "VantheaX"));
    await ensure_storage_dirs(paths);
    step = "stale temp file sweep";
    const swept = await sweep_tmp(storage_dirs(paths));
    if (swept) {
      console.info(`[storage] removed ${swept} stale temp files`);
    }
    step = "media";
    init_media({ attachments: paths.attachments, images: paths.images });
    step = "settings";
    await init_settings({
      files: { settings: paths.settings, secrets: paths.secrets, legacy_settings: paths.legacy_settings },
      codec: safe_storage_codec,
      on_change: (view) => emit("settings:changed", view),
    });
    step = "chats";
    await init_chats({
      dirs: { index_file: paths.chat_index, data_dir: paths.chat_data, search_dir: paths.chat_search },
      legacy_root: paths.user_data,
      events: {
        changed: (meta) => emit("chats:changed", meta),
        removed: (chat_id) => emit("chats:removed", { chat_id }),
        appended: (chat_id, message) => emit("chats:appended", { chat_id, message }),
        truncated: (chat_id, message_id) => emit("chats:truncated", { chat_id, message_id }),
      },
    });
    step = "artifacts";
    await init_artifacts({
      file: paths.artifacts,
      legacy_file: paths.legacy_artifacts,
      legacy_root: paths.user_data,
      on_change: (project_path) => emit("artifacts:changed", { project_path }),
    });
    step = "media protocol";
    register_media_protocol();
  } catch (error) {
    console.error(`[storage] init failed at step "${step}":`, error);
    throw error;
  }
};
