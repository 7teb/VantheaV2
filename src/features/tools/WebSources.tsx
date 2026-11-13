import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ToolView } from "../../../shared/tool-view.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, CircleAlertIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { reduced_motion } from "../../components/reduced-motion.ts";
import { use_t } from "../../i18n/index.ts";
import { follow, host_of, SourceIcon } from "./bodies-web.tsx";
import { page_address } from "./tool-meta.ts";
import "./WebSources.css";

const stack_limit = 6;
const avatar_step = 14;
const reveal_ms = 100;

type Flight = { index: number; from: DOMRect; into: "row" | "stack" };

type AvatarRefs = Map<number, HTMLSpanElement>;

const fly = (target: HTMLElement, from: DOMRect) => {
  const to = target.getBoundingClientRect();
  const root = getComputedStyle(document.documentElement);
  target.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "translate(0, 0)" }], {
    duration: parseFloat(root.getPropertyValue("--duration-spring")),
    easing: root.getPropertyValue("--ease-spring").trim(),
  });
};

const keep = (refs: AvatarRefs, index: number) => (node: HTMLSpanElement) => {
  refs.set(index, node);
  return () => {
    refs.delete(index);
  };
};

type WebSourcesProps = { view: Extract<ToolView, { kind: "web_search" }> };

export const WebSources = ({ view }: WebSourcesProps) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const [shown, set_shown] = useState(0);
  const stack = useRef<AvatarRefs>(new Map());
  const rows = useRef<AvatarRefs>(new Map());
  const flight = useRef<Flight | null>(null);
  const sources = view.sources;
  const failed = view.failed ?? [];
  const total = sources.length;
  const is_shown = (index: number) => shown > total - 1 - index;

  useEffect(() => {
    if ((open && shown >= total) || (!open && shown === 0)) {
      return;
    }
    const advance = () => {
      const index = open ? total - 1 - shown : total - shown;
      const origin = (open ? stack : rows).current.get(index);
      flight.current = origin && !reduced_motion() ? { index, from: origin.getBoundingClientRect(), into: open ? "row" : "stack" } : null;
      set_shown(open ? shown + 1 : shown - 1);
    };
    const timer = window.setTimeout(advance, reduced_motion() ? 0 : reveal_ms);
    return () => window.clearTimeout(timer);
  }, [open, shown, total]);

  useLayoutEffect(() => {
    const current = flight.current;
    flight.current = null;
    const target = current && (current.into === "row" ? rows : stack).current.get(current.index);
    if (current && target) {
      fly(target, current.from);
    }
  }, [shown]);

  const stacked = sources.slice(0, stack_limit);
  const waiting = stacked.filter((_, index) => !is_shown(index)).length;
  const hidden = total - stacked.length;
  return (
    <div className="web-sources-row" data-open={open}>
      <svg className="web-sources-elbow" width="12" height="15" viewBox="0 0 12 15" fill="none" aria-hidden="true">
        <path d="M0.5 0 V8 Q0.5 14 6.5 14 H11.5" pathLength="1" />
      </svg>
      <button type="button" className="web-sources-toggle" aria-expanded={open} onClick={() => set_open(!open)}>
        <span>{t("tools.sources")}</span>
        <span className="web-avatar-stack" style={{ width: waiting > 0 ? avatar_step * waiting + 6 : 0 }}>
          {stacked.map((source, index) =>
            is_shown(index) ? null : (
              <span key={index} ref={keep(stack.current, index)} className="web-avatar" style={{ zIndex: stacked.length - index }}>
                <SourceIcon host={host_of(source.url)} />
              </span>
            ),
          )}
        </span>
        {hidden > 0 && shown === 0 && <span className="web-sources-more">+{hidden}</span>}
        <ChevronRightIcon className="web-sources-chevron" />
      </button>
      {total > 0 && (
        <ul className="web-source-list">
          {sources.map((source, index) => {
            const host = host_of(source.url);
            const visible = is_shown(index);
            return (
              <li key={index} className="web-source-item" data-shown={visible} inert={!visible}>
                <div className="web-source-clip">
                  <a className="web-source-link" href={source.url} title={source.url} onClick={(event) => follow(event, source.url)}>
                    {visible ? (
                      <span ref={keep(rows.current, index)} className="web-avatar" style={{ zIndex: total - index }}>
                        <SourceIcon host={host} />
                      </span>
                    ) : (
                      <span className="web-avatar-slot" />
                    )}
                    <span className="web-source-text">
                      <span className="web-source-title">{source.title || host}</span>
                      <span className="web-source-host">{host}</span>
                    </span>
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(failed.length > 0 || view.answer !== "") && (
        <CollapsibleBody open={open}>
          <div className="web-sources-extra">
            {failed.map((entry, index) => (
              <div key={index} className="web-failure" title={entry.url}>
                <CircleAlertIcon />
                <span className="web-failure-url">{page_address(entry.url)}</span>
                <span className="web-failure-error">{entry.error}</span>
              </div>
            ))}
            {view.answer !== "" && (
              <div className="tool-body-quote">
                <Markdown text={view.answer} className="tool-body-markdown" />
              </div>
            )}
          </div>
        </CollapsibleBody>
      )}
    </div>
  );
};
