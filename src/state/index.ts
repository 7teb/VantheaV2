import { init_agents } from "./agents.ts";
import { init_artifacts } from "./artifacts.ts";
import { init_background } from "./background.ts";
import { init_browser } from "./browser.ts";
import { init_chat_view } from "./chat-view.ts";
import { init_chats } from "./chats.ts";
import { init_composer } from "./composer.ts";
import { init_extensions } from "./extensions.ts";
import { init_models } from "./models.ts";
import { init_settings } from "./settings.ts";
import { init_terminal } from "./terminal.ts";
import { init_window } from "./window.ts";

export const init_state = (): (() => void) => {
  const stops = [
    init_settings(),
    init_chats(),
    init_window(),
    init_chat_view(),
    init_composer(),
    init_terminal(),
    init_browser(),
    init_background(),
    init_agents(),
    init_artifacts(),
    init_extensions(),
    init_models(),
  ];
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
};
