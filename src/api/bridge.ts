import type { Bridge } from "../../shared/ipc/index.ts";
import { create_remote_bridge } from "./remote-bridge.ts";

declare global {
  interface Window {
    vx?: Bridge;
  }
}

export const remote_client = window.vx === undefined;

export const api: Bridge = window.vx ?? create_remote_bridge();
