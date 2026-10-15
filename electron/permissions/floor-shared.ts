import path from "node:path";

export type FloorScope = { app_root: string; project_root: string; cwd: string };

export const app_reason = "deleting or moving VantheaX's own chats, media or settings";

export const system_delete_reason = "deleting Windows / System32 / Program Files / a drive root / boot files";

export const system_variable_reason = "deleting a system path held in a variable";

export const hklm_reason = "deleting HKEY_LOCAL_MACHINE registry keys";

export const partition_reason = "diskpart / bcdedit can wipe partitions or break the boot configuration";

export const format_reason = "formatting a drive";

export const shadow_reason = "deleting volume shadow copies";

export const cipher_reason = "wiping free disk space with cipher /w";

const system_path =
  /(%systemroot%|%windir%|\$\{?env:(?:systemroot|windir|programfiles(?:\(x86\))?|programw6432)\}?|\$\{?env:systemdrive\}?[\\/]?(?=["'*\s)]|$)|[a-z]:\\windows\b|\\system32\b|[a-z]:\\program files|[\\/]boot[\\/]|[a-z]:[\\/](?=["'*\s)]|$))/i;

export const is_system_path = (text: string): boolean => system_path.test(text.replace(/\//g, "\\"));

export const mentions_app_data = (text: string): boolean => /appdata[\\/]roaming[\\/]vantheax/i.test(text);

export const path_key = (value: string) => path.win32.resolve(value).toLowerCase().replace(/\\+$/, "");

export const within = (root: string, target: string) => {
  const base = path_key(root);
  const key = path_key(target);
  return key === base || key.startsWith(`${base}\\`);
};

export const strictly_within = (root: string, target: string) => path_key(target).startsWith(`${path_key(root)}\\`);

export const in_project = (target: string | null, scope: FloorScope) =>
  target !== null && Boolean(scope.project_root) && strictly_within(scope.project_root, target);

export const hits_app = (target: string | null, scope: FloorScope) =>
  target !== null && Boolean(scope.app_root) && within(scope.app_root, target) && !in_project(target, scope);
