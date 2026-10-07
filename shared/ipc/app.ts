import { emit, invoke } from "./channel.ts";

export type WindowState = { maximized: boolean; fullscreen: boolean; focused: boolean; zoom: number };

export const app_channels = {
  "window:minimize": invoke<[], void>(),
  "window:toggle_maximize": invoke<[], void>(),
  "window:close": invoke<[], void>(),
  "window:fullscreen": invoke<[], void>(),
  "window:state": invoke<[], WindowState>(),
  "window:zoom": invoke<[delta: number], number>(),
  "window:changed": emit<WindowState>(),
  "shell:open_external": invoke<[url: string], void>(),
  "shell:reveal": invoke<[path: string], void>(),
} as const;
