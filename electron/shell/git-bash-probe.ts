import { execFile } from "node:child_process";
import fs from "node:fs";
import type { GitBashProbe } from "./git-bash.ts";

const read_install_path = (key: string): Promise<string | null> =>
  new Promise((resolve) => {
    execFile("reg.exe", ["query", key, "/v", "InstallPath"], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) {
        if (error.code !== 1) {
          console.warn(`[shell] reading InstallPath of ${key} failed: ${error.message}`);
        }
        resolve(null);
        return;
      }
      resolve(/InstallPath\s+REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(stdout)?.[1]?.trim() || null);
    });
  });

export const system_probe: GitBashProbe = { install_path: read_install_path, exists: fs.existsSync, env: process.env };
