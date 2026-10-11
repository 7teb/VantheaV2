import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export const keep_awake_store = create_store<boolean>(false);

export const load_keep_awake = async () => {
  try {
    keep_awake_store.set(await api.invoke("power:keep_awake"));
  } catch (error) {
    console.error("[power] power:keep_awake failed", error);
  }
};

export const set_keep_awake = async (enabled: boolean) => {
  try {
    keep_awake_store.set(await api.invoke("power:set_keep_awake", enabled));
  } catch (error) {
    console.error(`[power] power:set_keep_awake failed for enabled=${enabled}`, error);
  }
};
