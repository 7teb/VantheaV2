import { register_agents_ipc } from "./agents.ts";
import { register_app_ipc } from "./app.ts";
import { register_background_ipc } from "./background.ts";
import { register_browser_ipc } from "./browser.ts";
import { register_chats_ipc } from "./chats.ts";
import { register_extensions_ipc } from "./extensions.ts";
import { register_mcp_ipc } from "./mcp.ts";
import { register_media_ipc } from "./media.ts";
import { register_models_ipc } from "./models.ts";
import { register_project_ipc } from "./project.ts";
import { register_settings_ipc } from "./settings.ts";
import { register_turn_ipc } from "./turn.ts";
import { register_terminal_ipc } from "./terminal.ts";

export const register_ipc = () => {
  register_app_ipc();
  register_settings_ipc();
  register_models_ipc();
  register_chats_ipc();
  register_turn_ipc();
  register_media_ipc();
  register_browser_ipc();
  register_mcp_ipc();
  register_project_ipc();
  register_background_ipc();
  register_agents_ipc();
  register_extensions_ipc();
  register_terminal_ipc();
};
