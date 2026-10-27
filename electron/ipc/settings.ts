import { app, dialog, shell, type OpenDialogOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { SecretName } from "../../shared/settings.ts";
import { main_window } from "../app/window.ts";
import { delete_chat, project_chat_ids } from "../chats/store.ts";
import { create_project_folder } from "../project/create.ts";
import { read_folder_id } from "../project/folder.ts";
import { known_project_dir } from "../project/follow.ts";
import {
  add_project,
  get_settings,
  remove_project,
  secret_names,
  set_secret,
  settings_view,
  update_project,
  update_settings,
} from "../settings/store.ts";
import { optional_boolean, optional_string, require_record, require_string } from "../storage/coerce.ts";
import { handle } from "./handle.ts";

const dialog_text = {
  en: { choose: "Open a project folder", pick: "Choose the project folder" },
  de: { choose: "Projektordner öffnen", pick: "Projektordner wählen" },
} as const;

const texts = () => dialog_text[get_settings().language];

const project_path = (value: unknown) => require_string(value, "project path", 2000);

const secret_name = (value: unknown): SecretName => {
  const name = secret_names.find((entry) => entry === value);
  if (!name) {
    throw new Error(`unknown secret ${JSON.stringify(value)}`);
  }
  return name;
};

const project_patch = (value: unknown) => {
  const raw = require_record(value, "project patch");
  return { name: optional_string(raw, "name", "project name"), pinned: optional_boolean(raw, "pinned", "project pinned") };
};

const open_dialog = (options: OpenDialogOptions) => {
  const window = main_window();
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
};

const project_create = (value: unknown) => {
  const raw = require_record(value, "project create request");
  const name = require_string(raw.name, "project name", 120).trim();
  if (!name) {
    throw new Error("project name is empty");
  }
  if (raw.folder !== null && (typeof raw.folder !== "string" || !path.isAbsolute(raw.folder))) {
    throw new Error("project folder must be null or an absolute path");
  }
  return { name, folder: raw.folder };
};

const create_project = async (name: string, folder: string | null) => {
  if (folder !== null && !(await fs.stat(folder)).isDirectory()) {
    throw new Error(`project folder ${folder} is not a directory`);
  }
  const target = folder ?? (await create_project_folder(path.join(app.getPath("documents"), "VantheaX"), name));
  await add_project(target, await read_folder_id(target));
  await update_project(target, { name });
  return get_settings().projects.find((entry) => entry.path === target) ?? null;
};

export const register_settings_ipc = () => {
  handle("settings:get", () => settings_view());
  handle("settings:update", (patch) => update_settings(require_record(patch, "settings patch")));
  handle("settings:set_secret", (name, value) => set_secret(secret_name(name), require_string(value, "secret value", 4000)));
  handle("projects:choose", async () => {
    const result = await open_dialog({ title: texts().choose, properties: ["openDirectory"] });
    const chosen = result.filePaths[0];
    return result.canceled || !chosen ? null : add_project(chosen, await read_folder_id(chosen));
  });
  handle("projects:pick_folder", async () => {
    const result = await open_dialog({ title: texts().pick, properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle("projects:create", (request) => {
    const { name, folder } = project_create(request);
    return create_project(name, folder);
  });
  handle("projects:update", (path, patch) => update_project(project_path(path), project_patch(patch)));
  handle("projects:remove", async (path) => {
    const target = project_path(path);
    for (const chat_id of project_chat_ids(target)) {
      await delete_chat(chat_id);
    }
    return remove_project(target);
  });
  handle("projects:remove_all", async () => {
    for (const project of get_settings().projects) {
      for (const chat_id of project_chat_ids(project.path)) {
        await delete_chat(chat_id);
      }
      await remove_project(project.path);
    }
    return settings_view();
  });
  handle("projects:open", async (path) => {
    const error = await shell.openPath(await known_project_dir(path));
    if (error) {
      throw new Error(`opening the project folder failed: ${error}`);
    }
  });
};
