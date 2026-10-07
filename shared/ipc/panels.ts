import { emit, invoke, send } from "./channel.ts";

export type BrowserTabRegistration = { tab_id: string; web_contents_id: number; url: string };

export type BrowserCommand =
  | { command_id: string; action: "new"; url: string }
  | { command_id: string; action: "select"; tab_id: string }
  | { command_id: string; action: "close"; tab_id: string }
  | { command_id: string; action: "open_panel" };

export type BrowserCommandResult = { command_id: string; ok: boolean; tab_id: string | null; error: string | null };

export type TerminalCreate = { cwd: string; cols: number; rows: number };

export const panels_channels = {
  "browser:register_tab": invoke<[registration: BrowserTabRegistration], boolean>(),
  "browser:unregister_tab": invoke<[tab_id: string], void>(),
  "browser:set_active_tab": invoke<[tab_id: string | null], void>(),
  "browser:command_result": invoke<[result: BrowserCommandResult], void>(),
  "browser:wipe": invoke<[], void>(),
  "browser:command": emit<BrowserCommand>(),
  "browser:popup": emit<{ url: string }>(),
  "browser:partition": invoke<[], string>(),
  "terminal:create": invoke<[request: TerminalCreate], string>(),
  "terminal:input": send<[terminal_id: string, data: string]>(),
  "terminal:resize": send<[terminal_id: string, cols: number, rows: number]>(),
  "terminal:close": send<[terminal_id: string]>(),
  "terminal:data": emit<{ terminal_id: string; data: string }>(),
  "terminal:exit": emit<{ terminal_id: string; exit_code: number }>(),
} as const;
