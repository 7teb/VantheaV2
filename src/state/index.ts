import { init_agent_approvals } from "./agent-approvals.ts";
import { init_agents } from "./agents.ts";
import { init_artifacts } from "./artifacts.ts";
import { init_attention } from "./attention.ts";
import { init_background } from "./background.ts";
import { init_browser } from "./browser.ts";
import { init_chat_marks } from "./chat-marks.ts";
import { init_chat_view } from "./chat-view.ts";
import { init_chats } from "./chats.ts";
import { init_composer } from "./composer.ts";
import { init_event_hold } from "./event-hold.ts";
import { init_extensions } from "./extensions.ts";
import { init_files } from "./files.ts";
import { init_full_window } from "./full-window.ts";
import { init_git_diff } from "./git-diff.ts";
import { init_git } from "./git.ts";
import { init_github } from "./github.ts";
import { load_keep_awake } from "./keep-awake.ts";
import { init_models } from "./models.ts";
import { init_settings } from "./settings.ts";
import { init_terminal } from "./terminal.ts";
import { init_window } from "./window.ts";

export const init_state = (): (() => void) => {
  void load_keep_awake();
  const stops = [
    init_settings(),
    init_chats(),
    init_window(),
    init_chat_view(),
    init_attention(),
    init_chat_marks(),
    init_composer(),
    init_event_hold(),
    init_terminal(),
    init_browser(),
    init_background(),
    init_agents(),
    init_agent_approvals(),
    init_full_window(),
    init_artifacts(),
    init_extensions(),
    init_files(),
    init_git(),
    init_git_diff(),
    init_github(),
    init_models(),
  ];
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
};
