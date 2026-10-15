import type { AgentRunStatus, BackgroundStatus } from "../../../shared/ipc/work.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";

export const background_status_keys: Record<BackgroundStatus, MessageKey> = {
  running: "background.running_status",
  completed: "background.completed",
  failed: "background.failed",
  cancelled: "background.canceled",
  interrupted: "background.interrupted",
};

export const agent_status_keys: Record<AgentRunStatus, MessageKey> = {
  running: "agent.status_running",
  completed: "agent.status_completed",
  failed: "agent.status_failed",
  cancelled: "agent.status_cancelled",
  interrupted: "agent.status_interrupted",
};

const known = <K extends string>(keys: Record<K, MessageKey>, status: string): status is K => Object.hasOwn(keys, status);

export const background_status_label = (t: Translate, status: string): string => (known(background_status_keys, status) ? t(background_status_keys[status]) : status);

export const agent_status_label = (t: Translate, status: string): string => (known(agent_status_keys, status) ? t(agent_status_keys[status]) : status);

export type LiveStatus = { status: string | null; listed: boolean };

export const unknown_status: LiveStatus = { status: null, listed: false };

export const row_status_label = (t: Translate, label: (t: Translate, status: string) => string, stored: string, live: LiveStatus): string => {
  if (live.status !== null) {
    return label(t, live.status);
  }
  if (stored !== "running") {
    return label(t, stored);
  }
  return live.listed ? t("tools.status_ended") : "";
};
