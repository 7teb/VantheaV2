import type { ClaudeAccount } from "../../shared/claude.ts";
import { kill_claude_children } from "./process.ts";
import { probe_claude_account, unknown_claude_account } from "./status.ts";

type ClaudeServiceDeps = {
  changed: (account: ClaudeAccount) => void;
  probe?: () => Promise<ClaudeAccount>;
};

let changed: ClaudeServiceDeps["changed"] = () => {};
let probe: () => Promise<ClaudeAccount> = () => probe_claude_account();
let account: ClaudeAccount = unknown_claude_account;
let probing: Promise<ClaudeAccount> | null = null;

export const init_claude = (deps: ClaudeServiceDeps): void => {
  changed = deps.changed;
  probe = deps.probe ?? (() => probe_claude_account());
  account = unknown_claude_account;
  probing = null;
};

export const claude_account = (): ClaudeAccount => account;

export const refresh_claude_account = (): Promise<ClaudeAccount> => {
  if (probing) {
    return probing;
  }
  const started = probe()
    .then((next) => {
      account = next;
      changed(next);
      return next;
    })
    .finally(() => {
      if (probing === started) {
        probing = null;
      }
    });
  probing = started;
  return started;
};

export const shutdown_claude = (): void => {
  kill_claude_children();
};
