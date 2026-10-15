import { handle_debugger_message } from "./cdp.ts";
import { clear_console } from "./console.ts";
import { invalidate_tab, notify_tab, type BrowserTab } from "./state.ts";
import { decide_unload } from "./unload.ts";

type FailDetails = [unknown, number, string, string, boolean];

const aborted_load = -3;

export const watch_tab = (tab: BrowserTab, changed: () => void, destroyed: () => void): (() => void) => {
  const { guest } = tab;
  const debug = guest.debugger;
  const on_message = (_event: unknown, method: string, params: Record<string, unknown>, session_id: string) =>
    handle_debugger_message(tab, method, params ?? {}, session_id);
  const on_detach = () => {
    tab.debugger_attached = false;
    tab.sessions.clear();
    clear_console(tab.console);
    invalidate_tab(tab, true);
  };
  const on_start = () => {
    tab.loading = true;
    tab.error = "";
    notify_tab(tab);
    changed();
  };
  const on_stop = () => {
    tab.loading = false;
    tab.url = guest.getURL() || tab.url;
    tab.title = guest.getTitle() || tab.title;
    notify_tab(tab);
    changed();
  };
  const on_navigate = (_event: unknown, url: string) => {
    tab.url = url || tab.url;
    tab.crashed = false;
    invalidate_tab(tab, true);
    changed();
  };
  const on_in_page = (_event: unknown, url: string, is_main_frame: boolean) => {
    if (is_main_frame) {
      tab.url = url || tab.url;
      notify_tab(tab);
      changed();
    }
  };
  const on_title = (_event: unknown, title: string) => {
    tab.title = title;
    notify_tab(tab);
    changed();
  };
  const on_fail = (...[, code, description, url, is_main_frame]: FailDetails) => {
    if (!is_main_frame || code === aborted_load) {
      return;
    }
    console.warn(`[browser] tab ${tab.tab_id} failed to load ${url.slice(0, 200)}: ${description} (${code})`);
    tab.loading = false;
    tab.error = description || `error ${code}`;
    notify_tab(tab);
    changed();
  };
  const on_gone = (_event: unknown, details: { reason: string }) => {
    console.warn(`[browser] the page of tab ${tab.tab_id} is gone (${details.reason})`);
    tab.loading = false;
    tab.crashed = true;
    invalidate_tab(tab, true);
    changed();
  };
  const on_unload = (event: { preventDefault: () => void }) => decide_unload(tab, event);
  debug.on("message", on_message);
  debug.on("detach", on_detach);
  guest.on("did-start-loading", on_start);
  guest.on("did-stop-loading", on_stop);
  guest.on("did-navigate", on_navigate);
  guest.on("did-navigate-in-page", on_in_page);
  guest.on("page-title-updated", on_title);
  guest.on("did-fail-load", on_fail);
  guest.on("render-process-gone", on_gone);
  guest.on("will-prevent-unload", on_unload);
  guest.on("destroyed", destroyed);
  return () => {
    debug.off("message", on_message);
    debug.off("detach", on_detach);
    guest.off("did-start-loading", on_start);
    guest.off("did-stop-loading", on_stop);
    guest.off("did-navigate", on_navigate);
    guest.off("did-navigate-in-page", on_in_page);
    guest.off("page-title-updated", on_title);
    guest.off("did-fail-load", on_fail);
    guest.off("render-process-gone", on_gone);
    guest.off("will-prevent-unload", on_unload);
    guest.off("destroyed", destroyed);
  };
};
