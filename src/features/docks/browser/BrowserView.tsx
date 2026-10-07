import { useLayoutEffect, useRef, type RefObject } from "react";
import { t as translate, use_t } from "../../../i18n/index.ts";
import { browser_store, patch_browser_tab, register_guest, unregister_guest, type BrowserGuest, type BrowserTab } from "../../../state/browser.ts";

type NavigationEvent = Event & { url: string; isMainFrame?: boolean };
type TitleEvent = Event & { title: string };
type FailEvent = Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean };

const aborted_load = -3;

type BrowserViewProps = { tab: BrowserTab; active: boolean; partition: string; url_focused: RefObject<boolean> };

export const BrowserView = ({ tab, active, partition, url_focused }: BrowserViewProps) => {
  const t = use_t();
  const element = useRef<HTMLWebViewElement>(null);
  const tab_id = tab.id;
  const initial_url = tab.initial_url;

  useLayoutEffect(() => {
    const guest = element.current as BrowserGuest | null;
    if (!guest) {
      return;
    }
    const history = () => patch_browser_tab(tab_id, { can_back: guest.canGoBack(), can_forward: guest.canGoForward() });
    const editing = () => browser_store.get().active_id === tab_id && url_focused.current;
    const on_navigate = (event: Event) => {
      const { url } = event as NavigationEvent;
      patch_browser_tab(tab_id, editing() ? { url, error: "" } : { url, error: "", draft: null });
      history();
    };
    const on_in_page = (event: Event) => {
      if ((event as NavigationEvent).isMainFrame) {
        on_navigate(event);
      }
    };
    const on_attach = () => void register_guest(tab_id, guest);
    const on_start = () => patch_browser_tab(tab_id, { loading: true, error: "" });
    const on_stop = () => {
      patch_browser_tab(tab_id, { loading: false });
      history();
    };
    const on_title = (event: Event) => patch_browser_tab(tab_id, { title: (event as TitleEvent).title });
    const on_fail = (event: Event) => {
      const failure = event as FailEvent;
      if (!failure.isMainFrame || failure.errorCode === aborted_load) {
        return;
      }
      console.warn(`[browser] tab ${tab_id} failed to load ${failure.validatedURL}: ${failure.errorDescription} (${failure.errorCode})`);
      patch_browser_tab(tab_id, { loading: false, url: failure.validatedURL || initial_url, error: failure.errorDescription || translate("browser.load_failed") });
    };
    const on_gone = () => patch_browser_tab(tab_id, { loading: false, error: translate("browser.crashed") });
    const listeners: [string, (event: Event) => void][] = [
      ["did-attach", on_attach],
      ["did-start-loading", on_start],
      ["did-stop-loading", on_stop],
      ["did-navigate", on_navigate],
      ["did-navigate-in-page", on_in_page],
      ["page-title-updated", on_title],
      ["did-fail-load", on_fail],
      ["render-process-gone", on_gone],
    ];
    for (const [name, listener] of listeners) {
      guest.addEventListener(name, listener);
    }
    if (!guest.getAttribute("src")) {
      guest.setAttribute("partition", partition);
      guest.setAttribute("allowpopups", "");
      guest.setAttribute("src", initial_url);
    } else {
      void register_guest(tab_id, guest);
    }
    return () => {
      for (const [name, listener] of listeners) {
        guest.removeEventListener(name, listener);
      }
      unregister_guest(tab_id, guest);
    };
  }, [tab_id, initial_url, partition, url_focused]);

  return (
    <div className="browser-view" data-active={active}>
      <webview ref={element} className="browser-guest" />
      {tab.error && (
        <div className="browser-error" role="alert">
          <span>{t("browser.load_failed")}</span>
          {tab.error !== t("browser.load_failed") && <small>{tab.error}</small>}
        </div>
      )}
    </div>
  );
};
