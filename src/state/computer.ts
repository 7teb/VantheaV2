import type { ComputerSession } from "../../shared/ipc/computer.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export const computer_store = create_store<ComputerSession>({ chat_id: null, shortcut: false });

let received = 0;

const receive = (session: ComputerSession) => {
  received += 1;
  computer_store.set(session);
};

const load = async () => {
  const before = received;
  try {
    const session = await api.invoke("computer:state");
    if (received === before) {
      computer_store.set(session);
    }
  } catch (error) {
    console.error("[computer] computer:state failed", error);
  }
};

export const init_computer = (): (() => void) => {
  const stop = api.on("computer:changed", receive);
  void load();
  return stop;
};
