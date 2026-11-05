import type { ComputerControl } from "./control.ts";
import type { ComputerSession } from "../../shared/ipc/computer.ts";

let control: ComputerControl | null = null;

export const install_computer = (value: ComputerControl | null) => { control = value; };

export const get_computer = (): ComputerControl => {
  if (!control) throw new Error("Computer use is unavailable on this platform");
  return control;
};

export const computer_state = (): ComputerSession => control?.state() ?? { chat_id: null, shortcut: false };
export const release_computer = (chat_id: string, turn_id: string) => control?.release(chat_id, turn_id);
export const clear_computer = (chat_id: string) => control?.forget(chat_id);
export const close_computer = () => { control?.close(); control = null; };
