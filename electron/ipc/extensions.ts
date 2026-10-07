import { shell } from "electron";
import { init_memory, memory_loaded, memory_records, remove_memory, reset_memories, resolve_pending, review_items } from "../memory/store.ts";
import { init_skills, read_skill_raw, refresh_skills, remove_skill, set_skill_enabled, skill_entries, skills_root } from "../skills/store.ts";
import { error_text, require_string } from "../storage/coerce.ts";
import { storage_paths } from "../storage/paths.ts";
import { handle } from "./handle.ts";

const resolve_action = (value: unknown): "keep" | "discard" => {
  if (value !== "keep" && value !== "discard") {
    throw new Error(`memory review action must be keep or discard, got ${String(value).slice(0, 40)}`);
  }
  return value;
};

const loaded_memory = () => {
  if (!memory_loaded()) {
    throw new Error("the memory store did not load at startup, see the app log");
  }
};

export const init_extensions = async () => {
  const paths = storage_paths();
  try {
    await init_memory({ file: paths.memories, legacy_file: paths.legacy_memories });
  } catch (error) {
    console.error(`[extensions] memory store init from ${paths.memories} failed, memory stays off for this session: ${error_text(error)}`);
  }
  try {
    await init_skills({ root: paths.skills, legacy_root: paths.legacy_skills });
  } catch (error) {
    console.error(`[extensions] skills init from ${paths.skills} failed, no skills are loaded: ${error_text(error)}`);
  }
};

export const register_extensions_ipc = () => {
  handle("skills:list", async () => {
    await refresh_skills();
    return skill_entries();
  });
  handle("skills:body", (slug) => read_skill_raw(require_string(slug, "skill slug", 200)));
  handle("skills:set_enabled", async (slug, enabled) => {
    if (typeof enabled !== "boolean") {
      throw new Error("enabled must be a boolean");
    }
    await set_skill_enabled(require_string(slug, "skill slug", 200), enabled);
    return skill_entries();
  });
  handle("skills:remove", async (slug) => {
    await remove_skill(require_string(slug, "skill slug", 200));
    return skill_entries();
  });
  handle("skills:open_folder", async () => {
    const failure = await shell.openPath(skills_root());
    if (failure) {
      throw new Error(`opening ${skills_root()} failed: ${failure}`);
    }
  });
  handle("memory:list", () => {
    loaded_memory();
    return memory_records();
  });
  handle("memory:review", () => {
    loaded_memory();
    return review_items();
  });
  handle("memory:resolve", async (id, action) => {
    loaded_memory();
    await resolve_pending(require_string(id, "memory id", 200), resolve_action(action));
    return review_items();
  });
  handle("memory:remove", async (id) => {
    loaded_memory();
    const memory_id = require_string(id, "memory id", 200);
    if (!(await remove_memory(memory_id))) {
      throw new Error(`memory ${memory_id.slice(0, 80)} does not exist`);
    }
    return memory_records();
  });
  handle("memory:reset", () => {
    loaded_memory();
    return reset_memories();
  });
};
