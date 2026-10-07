import { useState, type MouseEvent } from "react";
import { GlobeIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import { open_external } from "../../state/chat-actions.ts";
import { Lightbox, type LightboxImage } from "../chat/Lightbox.tsx";
import { image_src } from "../chat/media.ts";
import { MediaImage } from "../chat/MediaImage.tsx";
import type { BodyProps } from "./body-types.ts";

const visible_sources = 4;

const host_of = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    console.error(`[tools] web source url ${url} is not a valid URL`, error);
    return url;
  }
};

const follow = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
  event.preventDefault();
  open_external(url);
};

export const WebSearchBody = ({ view }: BodyProps<"web_search">) => {
  const t = use_t();
  const [all, set_all] = useState(false);
  const shown = all ? view.sources : view.sources.slice(0, visible_sources);
  const hidden = view.sources.length - visible_sources;
  return (
    <div className="tool-body-stack">
      <div className="tool-body-line tool-body-muted">
        <span>{view.query}</span>
        <span>{t(view.depth === "advanced" ? "tools.depth_advanced" : "tools.depth_basic")}</span>
      </div>
      {view.sources.length > 0 && (
        <div className="web-sources">
          {shown.map((source, index) => (
            <a key={index} className="web-source" href={source.url} title={source.url} onClick={(event) => follow(event, source.url)}>
              <GlobeIcon size={14} />
              <span className="web-source-title">{source.title || host_of(source.url)}</span>
              <span className="web-source-host">{host_of(source.url)}</span>
            </a>
          ))}
          {hidden > 0 && (
            <button type="button" className="output-block-more" onClick={() => set_all(!all)}>
              {all ? t("chat.show_less") : t("tools.sources_more", { n: hidden })}
            </button>
          )}
        </div>
      )}
      {view.answer && (
        <div className="tool-body-quote">
          <Markdown text={view.answer} className="tool-body-markdown" />
        </div>
      )}
    </div>
  );
};

export const ImageBody = ({ view }: BodyProps<"image">) => {
  const [open, set_open] = useState<LightboxImage | null>(null);
  return (
    <div className="tool-body-stack">
      {view.prompt && <div className="tool-body-quote">{view.prompt}</div>}
      <div className="generated-images">
        {view.images.map((image) => {
          const src = image_src(image.id);
          const ratio = image.width && image.height ? image.width / image.height : null;
          return (
            <MediaImage key={image.id} src={src} alt={view.prompt} ratio={ratio} className="generated-image" on_open={() => set_open({ src, alt: view.prompt })} />
          );
        })}
      </div>
      <Lightbox image={open} on_close={() => set_open(null)} />
    </div>
  );
};
