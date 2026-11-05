import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { indicator_window, resize_indicator } from "../computer/indicator.ts";
import { computer_state } from "../computer/service.ts";
import { stop_turn } from "../turn/run.ts";
import { handle_window, listen_window } from "./handle.ts";

const from_indicator = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  const window = indicator_window();
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
};

export const register_computer_ipc = () => {
  handle_window("computer:state", from_indicator, computer_state);
  listen_window("computer:stop", from_indicator, () => {
    const chat_id = computer_state().chat_id;
    if (chat_id) stop_turn(chat_id);
  });
  listen_window("computer:indicator_size", from_indicator, resize_indicator);
};
