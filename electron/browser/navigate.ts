import { error_text, settle_within, tab_url, type BrowserTab } from "./state.ts";

export type NavigateAction = "goto" | "back" | "forward" | "reload";

export type NavigateOutcome = { url: string; loading: boolean };

const navigation_timeout_ms = 20000;

const load_outcome = (tab: BrowserTab, url: string): Promise<"loaded" | Error> =>
  tab.guest.loadURL(url).then(
    () => "loaded" as const,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );

const is_superseded = (error: Error) => (error as Error & { code?: string }).code === "ERR_ABORTED";

const goto = async (tab: BrowserTab, url: string, signal: AbortSignal): Promise<NavigateOutcome> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed_out = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), navigation_timeout_ms);
  });
  try {
    const outcome = await settle_within(Promise.race([load_outcome(tab, url), timed_out]), signal, navigation_timeout_ms + 1000, "Navigation");
    if (outcome instanceof Error && !is_superseded(outcome)) {
      throw new Error(`Navigation to ${url} failed: ${error_text(outcome)}`);
    }
    return { url: tab_url(tab), loading: outcome === "timeout" || tab.loading };
  } finally {
    clearTimeout(timer);
  }
};

export const navigate = async (tab: BrowserTab, action: NavigateAction, url: string, signal: AbortSignal): Promise<NavigateOutcome> => {
  if (action === "goto") {
    return goto(tab, url, signal);
  }
  if (action === "back") {
    if (!tab.guest.navigationHistory.canGoBack()) {
      throw new Error("Browser tab cannot go back.");
    }
    tab.guest.navigationHistory.goBack();
  } else if (action === "forward") {
    if (!tab.guest.navigationHistory.canGoForward()) {
      throw new Error("Browser tab cannot go forward.");
    }
    tab.guest.navigationHistory.goForward();
  } else {
    tab.guest.reload();
  }
  return { url: tab_url(tab), loading: true };
};
