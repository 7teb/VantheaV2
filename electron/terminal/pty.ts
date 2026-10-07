import { spawn } from "node-pty";
import type { PtyFactory } from "./sessions.ts";

export const spawn_shell: PtyFactory = ({ cwd, cols, rows }) => {
  const pty = spawn("powershell.exe", ["-NoLogo"], {
    name: "xterm-256color",
    cwd,
    cols,
    rows,
    env: process.env,
    useConptyDll: true,
  });
  return {
    write: (data) => pty.write(data),
    resize: (next_cols, next_rows) => pty.resize(next_cols, next_rows),
    kill: () => pty.kill(),
    on_data: (listener) => {
      pty.onData(listener);
    },
    on_exit: (listener) => {
      pty.onExit(({ exitCode }) => listener(exitCode));
    },
  };
};
