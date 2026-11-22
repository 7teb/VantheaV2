import { claude_account, refresh_claude_account } from "../claude/service.ts";
import { handle } from "./handle.ts";

export const register_claude_ipc = () => {
  handle("claude:status", () => claude_account());
  handle("claude:refresh", () => refresh_claude_account());
};
