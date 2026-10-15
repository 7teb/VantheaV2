import { init_browser_guest_security } from "./guest-security.ts";
import { init_surfaces, shutdown_surfaces } from "./surface.ts";
import { close_all_tabs } from "./tabs.ts";

export const init_browser = () => {
  init_browser_guest_security();
  init_surfaces();
};

export const shutdown_browser = () => {
  close_all_tabs();
  shutdown_surfaces();
};
