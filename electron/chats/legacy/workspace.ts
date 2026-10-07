import path from "node:path";

const legacy_folder_name = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, "").replace(/\.+$/, "").replace(/\s+/g, " ").trim().slice(0, 90) || "chat";

export const legacy_workspace = (legacy_root: string, project_path: string, workspace_name: string): string => {
  if (project_path || !workspace_name) {
    return "";
  }
  return path.join(legacy_root, "workspace", legacy_folder_name(workspace_name));
};
