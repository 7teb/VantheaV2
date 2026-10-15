import { useEffect, useRef, type FormEvent } from "react";
import type { BrowserTabInfo } from "../../../../shared/ipc/browser.ts";
import { IconButton } from "../../../components/Button.tsx";
import { ChevronLeftIcon, ChevronRightIcon, RetryIcon, SearchIcon } from "../../../components/icons.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { use_t } from "../../../i18n/index.ts";
import { browser_history, browser_store, load_browser_url, set_browser_draft, set_browser_editing } from "../../../state/browser.ts";
import { use_store } from "../../../state/use-store.ts";
import { display_browser_url, normalize_browser_url } from "./browser-url.ts";

type BrowserToolbarProps = { chat_key: string; tab: BrowserTabInfo | null; visible: boolean };

export const BrowserToolbar = ({ chat_key, tab, visible }: BrowserToolbarProps) => {
  const t = use_t();
  const input = useRef<HTMLInputElement>(null);
  const tab_id = tab?.tab_id ?? "";
  const draft = use_store(browser_store, (state) => (tab_id in state.drafts ? state.drafts[tab_id] : null));
  const blank = tab !== null && tab.url === "about:blank" && draft === null;

  useEffect(() => {
    if (!visible || !blank) {
      return;
    }
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [visible, blank, tab_id]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!tab) {
      return;
    }
    const url = normalize_browser_url(draft ?? tab.url);
    if (url) {
      void load_browser_url(chat_key, tab.tab_id, url);
      input.current?.blur();
    }
  };

  return (
    <form className="browser-toolbar" onSubmit={submit}>
      <IconButton label={t("browser.back")} size="sm" disabled={!tab?.can_back} onClick={() => void browser_history(chat_key, tab_id, "back")}>
        <ChevronLeftIcon size={16} />
      </IconButton>
      <IconButton label={t("browser.forward")} size="sm" disabled={!tab?.can_forward} onClick={() => void browser_history(chat_key, tab_id, "forward")}>
        <ChevronRightIcon size={16} />
      </IconButton>
      <IconButton label={t("browser.reload")} size="sm" disabled={!tab} onClick={() => void browser_history(chat_key, tab_id, "reload")}>
        <RetryIcon size={14} className={tab?.loading ? "spin" : undefined} />
      </IconButton>
      <TextField
        ref={input}
        className="browser-url"
        value={tab ? (draft ?? display_browser_url(tab.url)) : ""}
        on_change={(value) => tab && set_browser_draft(tab.tab_id, value)}
        icon={<SearchIcon size={14} />}
        placeholder={t("browser.url_placeholder")}
        aria-label={t("browser.url_placeholder")}
        disabled={!tab}
        onFocus={(event) => {
          set_browser_editing(tab_id);
          event.currentTarget.select();
        }}
        onBlur={() => set_browser_editing("")}
        onKeyDown={(event) => {
          if (event.key === "Escape" && tab) {
            event.preventDefault();
            set_browser_draft(tab.tab_id, null);
            event.currentTarget.blur();
          }
        }}
      />
      {tab?.loading && <span className="browser-progress" aria-hidden="true" />}
    </form>
  );
};
