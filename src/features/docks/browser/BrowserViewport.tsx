import { useRef } from "react";
import type { BrowserTabInfo } from "../../../../shared/ipc/browser.ts";
import { Skeleton } from "../../../components/Skeleton.tsx";
import { use_t, type Translate } from "../../../i18n/index.ts";
import { use_browser_viewport } from "./use-browser-viewport.ts";

type BrowserViewportProps = { chat_key: string; tab: BrowserTabInfo | null; visible: boolean };

const problem_of = (tab: BrowserTabInfo | null, t: Translate) => {
  if (tab?.crashed) {
    return t("browser.crashed");
  }
  return tab?.error ? t("browser.load_failed") : "";
};

export const BrowserViewport = ({ chat_key, tab, visible }: BrowserViewportProps) => {
  const t = use_t();
  const element = useRef<HTMLDivElement>(null);
  const problem = problem_of(tab, t);
  const frame = use_browser_viewport(element, chat_key, visible && tab !== null && !problem);

  return (
    <div ref={element} className="browser-viewport">
      {!tab && (
        <div className="browser-skeleton" aria-busy="true">
          <Skeleton width="100%" height="100%" radius={0} />
        </div>
      )}
      {frame && <img className="browser-frame" src={frame} alt="" draggable={false} />}
      {problem && (
        <div className="browser-error" role="alert">
          <span>{problem}</span>
          {tab?.error && !tab.crashed && <small>{tab.error}</small>}
        </div>
      )}
    </div>
  );
};
