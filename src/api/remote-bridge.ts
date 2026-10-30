import type { WindowState } from "../../shared/ipc/app.ts";
import type { Bridge, EventName, EventPayload, InvokeArgs, InvokeName, InvokeResult, SendArgs, SendName } from "../../shared/ipc/index.ts";
import { remote_local_channels, remote_refused } from "../../shared/remote-policy.ts";
import { invoke_local, on_window_changed } from "./remote-local.ts";
import { create_rpc } from "./remote-rpc.ts";
import { create_remote_stream } from "./remote-stream.ts";

const new_client_id = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const refused = (name: string) => new Error(`${name} is not available on a remote client`);

export const create_remote_bridge = (): Bridge => {
  const client_id = new_client_id();
  const stream = create_remote_stream(client_id);
  const rpc = create_rpc(client_id, stream.ready);

  const invoke = <K extends InvokeName>(name: K, ...args: InvokeArgs<K>): Promise<InvokeResult<K>> => {
    if (remote_local_channels.has(name)) {
      return invoke_local(name, args) as Promise<InvokeResult<K>>;
    }
    if (remote_refused.has(name)) {
      return Promise.reject(refused(name));
    }
    return rpc.invoke(name, args) as Promise<InvokeResult<K>>;
  };

  const send = <K extends SendName>(name: K, ...args: SendArgs<K>) => {
    if (remote_refused.has(name)) {
      console.error(`[remote] ${refused(name).message}`);
      return;
    }
    rpc.send(name, args);
  };

  const on = <K extends EventName>(name: K, listener: (payload: EventPayload<K>) => void): (() => void) => {
    if (name === "window:changed") {
      return on_window_changed(listener as (state: WindowState) => void);
    }
    return stream.on(name, listener as (payload: unknown) => void);
  };

  return { invoke, send, on, file_path: () => "" };
};
