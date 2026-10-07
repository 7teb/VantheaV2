import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { channel_kind, type Bridge } from "../shared/ipc/index.ts";

const require_kind = (name: string, kind: "invoke" | "send" | "event") => {
  if (channel_kind(name) !== kind) {
    throw new Error(`channel ${name} is not an allowed ${kind} channel`);
  }
};

const bridge: Bridge = {
  invoke: (name, ...args) => {
    require_kind(name, "invoke");
    return ipcRenderer.invoke(name, ...args);
  },
  send: (name, ...args) => {
    require_kind(name, "send");
    ipcRenderer.send(name, ...args);
  },
  on: (name, listener) => {
    require_kind(name, "event");
    const wrapped = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload);
    ipcRenderer.on(name, wrapped);
    return () => {
      ipcRenderer.removeListener(name, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("vx", bridge);
