import { dialog, type BaseWindow } from "electron";
import { get_settings } from "../settings/store.ts";
import { record_dialog } from "./dialogs.ts";
import { tab_url, type BrowserTab } from "./state.ts";

const leave_text = {
  en: {
    message: "Leave this page?",
    detail: "The page asks you to confirm before leaving it. Changes you made on it may not be saved.",
    leave: "Leave",
    stay: "Stay",
  },
  de: {
    message: "Diese Seite verlassen?",
    detail: "Die Seite möchte, dass du das Verlassen bestätigst. Deine Änderungen darauf werden eventuell nicht gespeichert.",
    leave: "Verlassen",
    stay: "Bleiben",
  },
} as const;

const ask_to_leave = (window: BaseWindow): boolean => {
  const text = leave_text[get_settings().language];
  const choice = dialog.showMessageBoxSync(window, {
    type: "question",
    buttons: [text.leave, text.stay],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: text.message,
    detail: text.detail,
  });
  return choice === 0;
};

const unload_outcome = (shown: boolean, leave: boolean) => {
  if (!shown) {
    return "allowed by the app, the navigation went ahead";
  }
  return leave ? "the user chose to leave the page" : "the user chose to stay, the navigation was cancelled";
};

export const decide_unload = (tab: BrowserTab, event: { preventDefault: () => void }) => {
  const shown = tab.host !== tab.surface;
  const leave = !shown || ask_to_leave(tab.host);
  if (leave) {
    event.preventDefault();
  }
  record_dialog(tab.dialogs, { type: "beforeunload", url: tab_url(tab), message: "", outcome: unload_outcome(shown, leave) });
};
