import { useEffect, useRef, type FormEvent, type RefObject } from "react";
import { IconButton } from "../../../components/Button.tsx";
import { ChevronLeftIcon, ChevronRightIcon, RetryIcon, SearchIcon } from "../../../components/icons.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { use_t } from "../../../i18n/index.ts";
import { load_browser_url, patch_browser_tab, run_guest, type BrowserTab } from "../../../state/browser.ts";
import { display_browser_url, normalize_browser_url } from "./browser-url.ts";

type BrowserToolbarProps = { tab: BrowserTab | null; visible: boolean; url_focused: RefObject<boolean> };

export const BrowserToolbar = ({ tab, visible, url_focused }: BrowserToolbarProps) => {
  const t = use_t();
  const input = useRef<HTMLInputElement>(null);
  const tab_id = tab?.id ?? "";
  const blank = tab !== null && tab.url === "about:blank" && tab.draft === null;

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
    const url = normalize_browser_url(tab.draft ?? tab.url);
    if (url && load_browser_url(tab.id, url)) {
      input.current?.blur();
    }
  };

  return (
    <form className="browser-toolbar" onSubmit={submit}>
      <IconButton label={t("browser.back")} size="sm" disabled={!tab?.can_back} onClick={() => run_guest(tab_id, (guest) => guest.goBack())}>
        <ChevronLeftIcon size={16} />
      </IconButton>
      <IconButton label={t("browser.forward")} size="sm" disabled={!tab?.can_forward} onClick={() => run_guest(tab_id, (guest) => guest.goForward())}>
        <ChevronRightIcon size={16} />
      </IconButton>
      <IconButton label={t("browser.reload")} size="sm" disabled={!tab?.registered} onClick={() => run_guest(tab_id, (guest) => guest.reload())}>
        <RetryIcon size={14} className={tab?.loading ? "spin" : undefined} />
      </IconButton>
      <TextField
        ref={input}
        className="browser-url"
        value={tab ? (tab.draft ?? display_browser_url(tab.url)) : ""}
        on_change={(value) => tab && patch_browser_tab(tab.id, { draft: value })}
        icon={<SearchIcon size={14} />}
        placeholder={t("browser.url_placeholder")}
        aria-label={t("browser.url_placeholder")}
        disabled={!tab}
        onFocus={(event) => {
          url_focused.current = true;
          event.currentTarget.select();
        }}
        onBlur={() => {
          url_focused.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && tab) {
            event.preventDefault();
            patch_browser_tab(tab.id, { draft: null });
            event.currentTarget.blur();
          }
        }}
      />
      {tab?.loading && <span className="browser-progress" aria-hidden="true" />}
    </form>
  );
};
