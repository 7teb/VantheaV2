import type { Bridge } from "../../shared/ipc/index.ts";

declare global {
  interface Window {
    vx: Bridge;
  }
}

export const api: Bridge = window.vx;
