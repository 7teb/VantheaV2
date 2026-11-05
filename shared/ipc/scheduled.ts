import type { ScheduledInput, ScheduledTaskView } from "../scheduled.ts";
import { emit, invoke } from "./channel.ts";

export type ScheduledChatTarget = { chat_id: string; project_path: string };

export const scheduled_channels = {
  "scheduled:list": invoke<[], ScheduledTaskView[]>(),
  "scheduled:save": invoke<[input: ScheduledInput, id: string | null], ScheduledTaskView[]>(),
  "scheduled:set_enabled": invoke<[id: string, enabled: boolean], ScheduledTaskView[]>(),
  "scheduled:remove": invoke<[id: string], ScheduledTaskView[]>(),
  "scheduled:run_now": invoke<[id: string], ScheduledTaskView[]>(),
  "scheduled:changed": emit<ScheduledTaskView[]>(),
  "scheduled:open_chat": emit<ScheduledChatTarget>(),
} as const;
