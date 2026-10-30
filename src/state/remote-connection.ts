import { connection_state, on_connection, type ConnectionState } from "../api/remote-stream.ts";
import { create_store } from "./create-store.ts";

export const remote_connection_store = create_store<ConnectionState>(connection_state());

export const init_remote_connection = (): (() => void) => {
  remote_connection_store.set(connection_state());
  return on_connection((state) => remote_connection_store.set(state));
};
