import type { AgentProfile, AgentRunStatus, AgentRunSummary } from "../../../../shared/ipc/work.ts";
import { CircleAlertIcon, CircleCheckIcon, CircleSlashIcon, LoaderIcon, type IconComponent } from "../../../components/icons.tsx";
import type { MessageKey } from "../../../i18n/index.ts";
import { format_duration } from "../../tools/tool-summary.ts";

export const status_labels: Record<AgentRunStatus, MessageKey> = {
  running: "agent.status_running",
  completed: "agent.status_completed",
  failed: "agent.status_failed",
  cancelled: "agent.status_cancelled",
  interrupted: "agent.status_interrupted",
};

export const status_icons: Record<AgentRunStatus, IconComponent> = {
  running: LoaderIcon,
  completed: CircleCheckIcon,
  failed: CircleAlertIcon,
  cancelled: CircleSlashIcon,
  interrupted: CircleAlertIcon,
};

export const profile_labels: Record<AgentProfile, MessageKey> = {
  explore: "agent.profile_explore",
  worker: "agent.profile_worker",
};

type Timed = Pick<AgentRunSummary, "started_at" | "ended_at">;

export const run_duration = (run: Timed, now: number): string => {
  const end = run.ended_at ? Date.parse(run.ended_at) : now;
  return format_duration(Math.max(0, end - Date.parse(run.started_at)));
};

export const first_line = (text: string) => text.trim().split("\n", 1)[0] ?? "";
