import type { RemoteStatus } from "../../shared/ipc/remote.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export const remote_store = create_store<RemoteStatus | null>(null);

export const init_remote = (): (() => void) => {
  api
    .invoke("remote:status")
    .then((status) => remote_store.set(status))
    .catch((error: unknown) => console.error("[remote] remote:status failed", error));
  return api.on("remote:changed", (status) => remote_store.set(status));
};

export const set_remote_enabled = async (enabled: boolean) => {
  try {
    remote_store.set(await api.invoke("remote:set_enabled", enabled));
  } catch (error) {
    console.error(`[remote] remote:set_enabled ${enabled} failed`, error);
  }
};

export const renew_remote_link = async () => {
  try {
    remote_store.set(await api.invoke("remote:renew_link"));
  } catch (error) {
    console.error("[remote] remote:renew_link failed", error);
  }
};
