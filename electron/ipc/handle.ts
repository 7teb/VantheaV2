import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { EventName, EventPayload, InvokeArgs, InvokeName, InvokeResult, SendArgs, SendName } from "../../shared/ipc/index.ts";
import { main_window } from "../app/window.ts";

const trusted = (event: IpcMainInvokeEvent | IpcMainEvent) => {
  const window = main_window();
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
};

export const handle = <K extends InvokeName>(
  name: K,
  handler: (...args: InvokeArgs<K>) => Promise<InvokeResult<K>> | InvokeResult<K>,
) => {
  ipcMain.handle(name, async (event, ...args) => {
    if (!trusted(event)) {
      throw new Error(`ipc ${name}: untrusted sender`);
    }
    try {
      return await handler(...(args as InvokeArgs<K>));
    } catch (error) {
      console.error(`[ipc] ${name} failed:`, error);
      throw error;
    }
  });
};

export const listen = <K extends SendName>(name: K, handler: (...args: SendArgs<K>) => void) => {
  ipcMain.on(name, (event, ...args) => {
    if (!trusted(event)) {
      return;
    }
    try {
      handler(...(args as SendArgs<K>));
    } catch (error) {
      console.error(`[ipc] ${name} failed:`, error);
    }
  });
};

export const emit = <K extends EventName>(name: K, payload: EventPayload<K>) => {
  const window = main_window();
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send(name, payload);
};
