import { useState, type MouseEvent } from "react";
import { CircleAlertIcon, GlobeIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_language, use_t } from "../../i18n/index.ts";
import { open_external } from "../../state/chat-actions.ts";
import { Lightbox, type LightboxImage } from "../chat/Lightbox.tsx";
import { favicon_src, image_src } from "../chat/media.ts";
import { MediaImage } from "../chat/MediaImage.tsx";
import type { BodyProps } from "./body-types.ts";
import { page_address } from "./tool-meta.ts";
import "./bodies-web.css";

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

const published = (raw: string, language: string) => {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

const SourceIcon = ({ host }: { host: string }) => {
  const [failed, set_failed] = useState(false);
  if (failed) {
    return <GlobeIcon size={14} />;
  }
  return <img className="web-source-icon" src={favicon_src(host)} alt="" width={14} height={14} onError={() => set_failed(true)} />;
};

export const WebSearchBody = ({ view }: BodyProps<"web_search">) => {
  const t = use_t();
  const language = use_language();
  const [all, set_all] = useState(false);
  const shown = all ? view.sources : view.sources.slice(0, visible_sources);
  const hidden = view.sources.length - visible_sources;
  const failed = view.failed ?? [];
  return (
    <div className="tool-body-stack">
      {(view.sources.length > 0 || failed.length > 0) && (
        <div className="web-sources">
          {shown.map((source, index) => {
            const host = host_of(source.url);
            return (
              <a key={index} className="web-source" href={source.url} title={source.url} onClick={(event) => follow(event, source.url)}>
                <SourceIcon host={host} />
                <span className="web-source-title">{source.title || host}</span>
                <span className="web-source-host">{host}</span>
                {source.published_date && <span className="web-source-date">{published(source.published_date, language)}</span>}
              </a>
            );
          })}
          {hidden > 0 && (
            <button type="button" className="output-block-more" onClick={() => set_all(!all)}>
              {all ? t("chat.show_less") : t("tools.sources_more", { n: hidden })}
            </button>
          )}
          {failed.map((entry, index) => (
            <div key={`failed:${index}`} className="web-failure" title={entry.url}>
              <CircleAlertIcon size={14} />
              <span className="web-failure-url">{page_address(entry.url)}</span>
              <span className="web-failure-error">{entry.error}</span>
            </div>
          ))}
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
      {view.images.length > 0 && (
        <div className="generated-images">
          {view.images.map((image) => {
            const src = image_src(image.id);
            const ratio = image.width && image.height ? image.width / image.height : null;
            return (
              <MediaImage key={image.id} src={src} alt={view.prompt} ratio={ratio} className="generated-image" on_open={() => set_open({ src, alt: view.prompt })} />
            );
          })}
        </div>
      )}
      <Lightbox image={open} on_close={() => set_open(null)} />
    </div>
  );
};
