import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StreamEventBody } from "../shared/events.ts";
import type { Hook, HooksConfig } from "../shared/hooks.ts";
import { init_chats } from "../electron/chats/store.ts";
import type { HookIdentity } from "../electron/hooks/input.ts";
import { init_settings, update_settings } from "../electron/settings/store.ts";
import type { SecretCodec } from "../electron/storage/secrets.ts";

export const plain_codec: SecretCodec = { available: () => true, encrypt: (plain) => plain, decrypt: (cipher) => cipher };

export const temp_root = (name: string): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), `vx-hooks-${name}-`));

export const start_settings = (root: string) =>
  init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy-settings.json") },
    codec: plain_codec,
    on_change: () => undefined,
  });

export const start_chats = (root: string) =>
  init_chats({
    dirs: { index_file: path.join(root, "chats", "index.json"), data_dir: path.join(root, "chats", "data"), search_dir: path.join(root, "chats", "search") },
    legacy_root: path.join(root, "legacy"),
    events: { changed: () => undefined, removed: () => undefined, appended: () => undefined, truncated: () => undefined, questions: () => undefined },
  });

export const set_hooks = (hooks: HooksConfig) => update_settings({ hooks });

let counter = 0;

export const hook = (over: Partial<Hook> = {}): Hook => {
  counter += 1;
  return { id: `hook-${counter}`, event: "PreToolUse", matcher: "", shell: "powershell", command: "exit 0", timeout_s: 60, enabled: true, ...over };
};

export const ps_path = (file: string): string => file.replace(/'/g, "''");

export const read_stdin = "$e = [Console]::In.ReadToEnd() | ConvertFrom-Json";

export type IdentityKit = { identity: HookIdentity; events: StreamEventBody[]; controller: AbortController };

export const identity_kit = (cwd: string, over: Partial<HookIdentity> = {}): IdentityKit => {
  const events: StreamEventBody[] = [];
  const controller = new AbortController();
  const identity: HookIdentity = {
    chat_id: "chat-hooks",
    turn_id: "turn-1",
    cwd,
    project_path: "",
    mode: "auto",
    plan: false,
    agent: null,
    emit: (body) => events.push(body),
    signal: controller.signal,
    ...over,
  };
  return { identity, events, controller };
};
