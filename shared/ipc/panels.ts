import { emit, invoke, send } from "./channel.ts";
import type { FilesScope } from "./files.ts";

export type TerminalCreate = FilesScope & { cols: number; rows: number };

export const panels_channels = {
  "terminal:create": invoke<[request: TerminalCreate], string>(),
  "terminal:input": send<[terminal_id: string, data: string]>(),
  "terminal:resize": send<[terminal_id: string, cols: number, rows: number]>(),
  "terminal:close": send<[terminal_id: string]>(),
  "terminal:adopt": invoke<[terminal_id: string, chat_id: string], void>(),
  "terminal:data": emit<{ terminal_id: string; data: string }>(),
  "terminal:exit": emit<{ terminal_id: string; exit_code: number }>(),
} as const;
