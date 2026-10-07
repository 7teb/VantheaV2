import { dialog, shell, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import fs from "node:fs/promises";
import type { SecretName } from "../../shared/settings.ts";
import { main_window } from "../app/window.ts";
import { delete_chat, project_chat_ids } from "../chats/store.ts";
import { read_folder_id } from "../project/folder.ts";
import { follow_project } from "../project/follow.ts";
import {
  add_project,
  find_project,
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
  en: { choose: "Open a project folder", create: "Create a new project folder", create_button: "Create" },
  de: { choose: "Projektordner öffnen", create: "Neuen Projektordner anlegen", create_button: "Anlegen" },
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

const save_dialog = (options: SaveDialogOptions) => {
  const window = main_window();
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
};

const known_project_dir = async (value: unknown): Promise<string> => {
  const entry = find_project(project_path(value));
  if (!entry) {
    throw new Error(`refusing to open ${String(value)}: it is not in the project list`);
  }
  const dir = await follow_project(entry.path);
  const stat = await fs.stat(dir);
  if (!stat.isDirectory()) {
    throw new Error(`project path ${dir} is not a directory`);
  }
  return dir;
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
  handle("projects:create", async () => {
    const result = await save_dialog({ title: texts().create, buttonLabel: texts().create_button, properties: ["createDirectory", "showOverwriteConfirmation"] });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await fs.mkdir(result.filePath, { recursive: true });
    return add_project(result.filePath, await read_folder_id(result.filePath));
  });
  handle("projects:update", (path, patch) => update_project(project_path(path), project_patch(patch)));
  handle("projects:remove", async (path) => {
    const target = project_path(path);
    for (const chat_id of project_chat_ids(target)) {
      await delete_chat(chat_id);
    }
    return remove_project(target);
  });
  handle("projects:open", async (path) => {
    const error = await shell.openPath(await known_project_dir(path));
    if (error) {
      throw new Error(`opening the project folder failed: ${error}`);
    }
  });
};
