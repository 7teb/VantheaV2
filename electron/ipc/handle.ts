import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { EventName, EventPayload, InvokeArgs, InvokeName, InvokeResult, SendArgs, SendName } from "../../shared/ipc/index.ts";
import { main_window } from "../app/window.ts";
import { window_client, type ClientId } from "./clients.ts";

type InvokeDispatcher = (client: ClientId, args: unknown[]) => unknown;

type SendDispatcher = (client: ClientId, args: unknown[]) => void;

type EventTap = (target: ClientId | null, name: EventName, payload: unknown) => void;

const invoke_handlers = new Map<InvokeName, InvokeDispatcher>();

const send_handlers = new Map<SendName, SendDispatcher>();

let event_tap: EventTap | null = null;

const trusted = (event: IpcMainInvokeEvent | IpcMainEvent) => {
  const window = main_window();
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
};

export const dispatch_invoke = async (client: ClientId, name: InvokeName, args: unknown[]): Promise<unknown> => {
  const handler = invoke_handlers.get(name);
  if (!handler) {
    throw new Error(`no handler for ${name}`);
  }
  try {
    return await handler(client, args);
  } catch (error) {
    console.error(`[ipc] ${name} from ${client} failed:`, error);
    throw error;
  }
};

export const dispatch_send = (client: ClientId, name: SendName, args: unknown[]): void => {
  const handler = send_handlers.get(name);
  if (!handler) {
    throw new Error(`no handler for ${name}`);
  }
  try {
    handler(client, args);
  } catch (error) {
    console.error(`[ipc] ${name} from ${client} failed:`, error);
  }
};

const register_invoke = (name: InvokeName, dispatcher: InvokeDispatcher) => {
  invoke_handlers.set(name, dispatcher);
  ipcMain.handle(name, async (event, ...args) => {
    if (!trusted(event)) {
      throw new Error(`ipc ${name}: untrusted sender`);
    }
    return dispatch_invoke(window_client, name, args);
  });
};

const register_send = (name: SendName, dispatcher: SendDispatcher) => {
  send_handlers.set(name, dispatcher);
  ipcMain.on(name, (event, ...args) => {
    if (!trusted(event)) {
      return;
    }
    dispatch_send(window_client, name, args);
  });
};

export const handle = <K extends InvokeName>(name: K, handler: (...args: InvokeArgs<K>) => Promise<InvokeResult<K>> | InvokeResult<K>) =>
  register_invoke(name, (_client, args) => handler(...(args as InvokeArgs<K>)));

export const handle_client = <K extends InvokeName>(
  name: K,
  handler: (client: ClientId, ...args: InvokeArgs<K>) => Promise<InvokeResult<K>> | InvokeResult<K>,
) => register_invoke(name, (client, args) => handler(client, ...(args as InvokeArgs<K>)));

export const listen = <K extends SendName>(name: K, handler: (...args: SendArgs<K>) => void) =>
  register_send(name, (_client, args) => handler(...(args as SendArgs<K>)));

export const listen_client = <K extends SendName>(name: K, handler: (client: ClientId, ...args: SendArgs<K>) => void) =>
  register_send(name, (client, args) => handler(client, ...(args as SendArgs<K>)));

export const set_event_tap = (tap: EventTap | null): void => {
  event_tap = tap;
};

const tap_event = (target: ClientId | null, name: EventName, payload: unknown) => {
  if (!event_tap) {
    return;
  }
  try {
    event_tap(target, name, payload);
  } catch (error) {
    console.error(`[ipc] forwarding ${name} to ${target ?? "every remote client"} failed:`, error);
  }
};

const send_to_window = (name: EventName, payload: unknown) => {
  const window = main_window();
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send(name, payload);
};

export const emit = <K extends EventName>(name: K, payload: EventPayload<K>) => {
  send_to_window(name, payload);
  tap_event(null, name, payload);
};

export const emit_to = <K extends EventName>(client: ClientId, name: K, payload: EventPayload<K>) => {
  if (client === window_client) {
    send_to_window(name, payload);
    return;
  }
  tap_event(client, name, payload);
};
