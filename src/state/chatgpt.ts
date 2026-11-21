import type { ChatgptAccount, ChatgptSignIn } from "../../shared/chatgpt.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export const chatgpt_store = create_store<ChatgptAccount | null>(null);

export const init_chatgpt = (): (() => void) => {
  api
    .invoke("chatgpt:status")
    .then((account) => chatgpt_store.set(account))
    .catch((error: unknown) => console.error("[chatgpt] chatgpt:status failed", error));
  return api.on("chatgpt:changed", (account) => chatgpt_store.set(account));
};

const store_result = async (channel: string, call: () => Promise<ChatgptAccount>) => {
  try {
    chatgpt_store.set(await call());
  } catch (error) {
    console.error(`[chatgpt] ${channel} failed`, error);
  }
};

export const sign_in = (request: ChatgptSignIn) =>
  store_result(`chatgpt:sign_in fresh=${request.fresh} consent=${request.consent}`, () => api.invoke("chatgpt:sign_in", request));

export const cancel_sign_in = () => store_result("chatgpt:cancel_sign_in", () => api.invoke("chatgpt:cancel_sign_in"));

export const sign_out = () => store_result("chatgpt:sign_out", () => api.invoke("chatgpt:sign_out"));

export const dismiss_notice = () => store_result("chatgpt:dismiss_notice", () => api.invoke("chatgpt:dismiss_notice"));
