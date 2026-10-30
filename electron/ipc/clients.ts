export type ClientId = "window" | `remote:${string}`;

export const window_client: ClientId = "window";

type PresenceListener = (client: ClientId, connected: boolean) => void;

type GoneListener = (client: ClientId) => void;

const connected = new Set<ClientId>();

const known = new Set<ClientId>();

const presence_listeners: PresenceListener[] = [];

const gone_listeners: GoneListener[] = [];

const run_listener = (client: ClientId, kind: string, index: number, call: () => void) => {
  try {
    call();
  } catch (error) {
    console.error(`[clients] ${kind} listener ${index} failed for client ${client}:`, error);
  }
};

export const client_connected = (client: ClientId): boolean => client === window_client || connected.has(client);

export const note_client = (client: ClientId): void => {
  if (client !== window_client) {
    known.add(client);
  }
};

export const known_clients = (): ClientId[] => [...known];

export const set_client_connected = (client: ClientId, state: boolean): void => {
  if (client === window_client || connected.has(client) === state) {
    return;
  }
  note_client(client);
  if (state) {
    connected.add(client);
  } else {
    connected.delete(client);
  }
  presence_listeners.forEach((listener, index) => run_listener(client, "presence", index, () => listener(client, state)));
};

export const client_gone = (client: ClientId): void => {
  if (client === window_client) {
    return;
  }
  connected.delete(client);
  known.delete(client);
  gone_listeners.forEach((listener, index) => run_listener(client, "gone", index, () => listener(client)));
};

export const on_client_presence = (listener: PresenceListener): void => {
  presence_listeners.push(listener);
};

export const on_client_gone = (listener: GoneListener): void => {
  gone_listeners.push(listener);
};

export const remote_client_id = (session_id: string, page_id: string): ClientId => `remote:${session_id}.${page_id}`;

export const client_session = (client: ClientId): string | null => (client === window_client ? null : client.slice("remote:".length, client.lastIndexOf(".")));
