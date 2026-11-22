import type { ClaudeAccount } from "../../shared/claude.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export const claude_store = create_store<ClaudeAccount | null>(null);

export const init_claude = (): (() => void) => {
  api
    .invoke("claude:status")
    .then((account) => claude_store.set(account))
    .catch((error: unknown) => console.error("[claude] claude:status failed", error));
  return api.on("claude:changed", (account) => claude_store.set(account));
};

export const refresh_claude = async () => {
  try {
    claude_store.set(await api.invoke("claude:refresh"));
  } catch (error) {
    console.error("[claude] claude:refresh failed", error);
  }
};
