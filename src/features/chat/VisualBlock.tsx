import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ToolView } from "../../../shared/tool-view.ts";
import { read_visual_message, visual_document, visual_frame_file } from "../../../shared/visual-doc.ts";
import { use_t } from "../../i18n/index.ts";
import { visual_vars_css } from "./visual-theme.ts";
import "./VisualBlock.css";

type VisualView = Extract<ToolView, { kind: "visual" }>;

const measured = new Map<string, number>();

const remember_height = (code: string, height: number) => {
  measured.delete(code);
  measured.set(code, height);
  const [oldest] = measured.keys();
  if (measured.size > 200) {
    measured.delete(oldest);
  }
};

const app_vars_css = (): string => {
  const style = getComputedStyle(document.documentElement);
  return visual_vars_css((token) => style.getPropertyValue(token).trim());
};

type VisualBlockProps = { view: VisualView };

const same_view = (before: VisualBlockProps, after: VisualBlockProps) => before.view.code === after.view.code && before.view.title === after.view.title;

export const VisualBlock = memo(({ view }: VisualBlockProps) => {
  const t = use_t();
  const frame = useRef<HTMLIFrameElement>(null);
  const document_text = useMemo(() => visual_document(view.code, app_vars_css()), [view.code]);
  const [height, set_height] = useState<number | null>(() => measured.get(view.code) ?? null);
  const [error, set_error] = useState("");

  useLayoutEffect(() => {
    const on_message = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target) {
        return;
      }
      const message = read_visual_message(event.data);
      if (message?.kind === "ready") {
        target.postMessage(document_text, "*");
        return;
      }
      if (message?.kind === "height") {
        remember_height(view.code, message.height);
        set_height(message.height);
        return;
      }
      if (message?.kind === "error") {
        set_error(message.error);
      }
    };
    window.addEventListener("message", on_message);
    return () => window.removeEventListener("message", on_message);
  }, [view.code, document_text]);

  return (
    <figure className="visual-block" data-measured={height !== null}>
      <iframe ref={frame} className="visual-frame" title={view.title} sandbox="allow-scripts" src={visual_frame_file} style={{ height: height ?? 0 }} />
      {error && (
        <figcaption className="visual-error" title={error}>
          {t("chat.visual_error", { error })}
        </figcaption>
      )}
    </figure>
  );
}, same_view);
