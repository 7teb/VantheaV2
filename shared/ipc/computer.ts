import { emit, invoke, send } from "./channel.ts";

export type ComputerSession = { chat_id: string | null; shortcut: boolean };

export const computer_channels = {
  "computer:state": invoke<[], ComputerSession>(),
  "computer:changed": emit<ComputerSession>(),
  "computer:stop": send<[]>(),
  "computer:indicator_size": send<[width: number, height: number]>(),
} as const;
