import { useState, type CSSProperties } from "react";
import { use_t } from "../../i18n/index.ts";
import { chat_messages } from "../../state/chat-view-reduce.ts";
import { chat_view_store } from "../../state/chat-view.ts";
import { use_store } from "../../state/use-store.ts";
import { Lightbox, type LightboxImage } from "../chat/Lightbox.tsx";
import { tool_image_src } from "../chat/media.ts";
import { MediaImage } from "../chat/MediaImage.tsx";
import type { ChatBodyProps } from "./body-types.ts";
import { shot_frame, type ShotMark } from "./computer-shots.ts";
import "./computer.css";

const DragPath = ({ from, to }: { from: ShotMark; to: ShotMark }) => (
  <svg className="computer-shot-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
  </svg>
);

export const ComputerBody = ({ view, step, chat_id }: ChatBodyProps<"computer">) => {
  const t = use_t();
  const messages = use_store(chat_view_store, (state) => chat_messages(state, chat_id));
  const [open, set_open] = useState<LightboxImage | null>(null);
  const frame = shot_frame(messages, step, view);
  if (!frame) {
    return null;
  }
  const src = tool_image_src(frame.image.id);
  const alt = t("computer.screenshot_alt");
  const { marks, ratio } = frame;
  return (
    <>
      <figure className="computer-shot" style={{ "--shot-ratio": ratio } as CSSProperties}>
        <MediaImage src={src} alt={alt} ratio={ratio} on_open={() => set_open({ src, alt })} />
        {marks.length === 2 && <DragPath from={marks[0]} to={marks[1]} />}
        {marks.map((mark, index) => (
          <span key={index} className="computer-shot-mark" style={{ left: `${mark.x}%`, top: `${mark.y}%` }} />
        ))}
      </figure>
      <Lightbox image={open} on_close={() => set_open(null)} />
    </>
  );
};
