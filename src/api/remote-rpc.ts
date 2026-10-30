import { client_header, decode_wire, encode_wire, rpc_path, type RpcReply } from "../../shared/remote-wire.ts";

export type RemoteRpc = {
  invoke: (channel: string, args: unknown[]) => Promise<unknown>;
  send: (channel: string, args: unknown[]) => void;
};

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

const read_reply = (status: number, text: string): RpcReply => {
  if (text === "") {
    return { ok: false, error: `the PC answered HTTP ${status}` };
  }
  try {
    const reply = decode_wire(text);
    if (typeof reply === "object" && reply !== null && typeof (reply as { ok?: unknown }).ok === "boolean") {
      return reply as RpcReply;
    }
  } catch (error) {
    console.error(`[remote] the PC answered HTTP ${status} with an unreadable body: ${text.slice(0, 200)}`, error);
  }
  return { ok: false, error: `the PC answered HTTP ${status}` };
};

export const create_rpc = (client_id: string, ready: () => Promise<void>): RemoteRpc => {
  let queue: Promise<void> = Promise.resolve();

  const post = async (channel: string, args: unknown[]): Promise<unknown> => {
    await ready();
    let response: Response;
    try {
      response = await fetch(rpc_path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", [client_header]: client_id },
        body: encode_wire({ channel, args }),
      });
    } catch (error) {
      throw new Error(`PC not reachable: ${error_text(error)}`);
    }
    if (response.status === 401) {
      location.reload();
      throw new Error("this device is not paired with the PC");
    }
    const reply = read_reply(response.status, await response.text());
    if (!reply.ok) {
      throw new Error(reply.error);
    }
    return reply.result;
  };

  return {
    invoke: post,
    send: (channel, args) => {
      queue = queue
        .then(() => post(channel, args))
        .then(
          () => undefined,
          (error: unknown) => console.error(`[remote] ${channel} failed`, error),
        );
    },
  };
};
