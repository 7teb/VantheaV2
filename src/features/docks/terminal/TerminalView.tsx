import { useEffect, useLayoutEffect, useRef } from "react";
import { attach_session, detach_session, fit_session, focus_session } from "./terminal-sessions.ts";

type TerminalViewProps = { tab_id: string; active: boolean; focused: boolean };

export const TerminalView = ({ tab_id, active, focused }: TerminalViewProps) => {
  const container = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) {
      return;
    }
    attach_session(tab_id, node);
    const observer = new ResizeObserver(() => fit_session(tab_id));
    observer.observe(node);
    return () => {
      observer.disconnect();
      detach_session(tab_id);
    };
  }, [tab_id]);

  useEffect(() => {
    if (!focused) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      fit_session(tab_id);
      focus_session(tab_id);
    });
    return () => cancelAnimationFrame(frame);
  }, [focused, tab_id]);

  return <div ref={container} className="terminal-view" data-active={active} onMouseDown={() => focus_session(tab_id)} />;
};
