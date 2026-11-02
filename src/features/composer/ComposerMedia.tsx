import { useMemo, useState, type AnimationEvent, type KeyboardEvent } from "react";
import { CloseSmallIcon, FileTextIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { DraftUpload } from "../../state/chat-drafts.ts";
import { discard_upload } from "../../state/composer.ts";
import { Lightbox, type LightboxImage } from "../chat/Lightbox.tsx";
import { attachment_src, attachment_thumb_src } from "../chat/media.ts";
import { use_leaving_rows } from "./use-leaving-rows.ts";
import "./ComposerMedia.css";

const tile_src = (upload: DraftUpload): string | null => upload.preview ?? (upload.attachment ? attachment_thumb_src(upload.attachment) : null);

const original_src = (upload: DraftUpload): string | null => (upload.attachment ? attachment_src(upload.attachment) : upload.preview);

const RemoveButton = ({ name, on_remove }: { name: string; on_remove: () => void }) => {
  const t = use_t();
  return (
    <button
      type="button"
      className="composer-media-remove"
      aria-label={t("composer.remove_attachment", { name })}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        on_remove();
      }}
    >
      <CloseSmallIcon />
    </button>
  );
};

type TileProps = { upload: DraftUpload; leaving: boolean; on_left: () => void; on_remove: () => void };

const leave_end = (leaving: boolean, on_left: () => void) => (event: AnimationEvent<HTMLDivElement>) => {
  if (leaving && event.target === event.currentTarget) {
    on_left();
  }
};

const ImageTile = ({ upload, leaving, on_left, on_remove, on_open }: TileProps & { on_open: (image: LightboxImage) => void }) => {
  const t = use_t();
  const src = tile_src(upload);
  const open = () => {
    const original = original_src(upload);
    if (original) {
      on_open({ src: original, alt: upload.name });
    }
  };
  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    open();
  };
  return (
    <div
      className="composer-media-tile"
      data-status={upload.status}
      data-leaving={leaving}
      inert={leaving}
      onAnimationEnd={leave_end(leaving, on_left)}
      role="button"
      tabIndex={0}
      aria-label={t("composer.open_attachment", { name: upload.name })}
      onClick={open}
      onKeyDown={on_key_down}
    >
      <span className="composer-media-frame">{src && <img src={src} alt="" />}</span>
      <RemoveButton name={upload.name} on_remove={on_remove} />
    </div>
  );
};

const FileTile = ({ upload, leaving, on_left, on_remove }: TileProps) => (
  <div
    className="composer-media-tile composer-media-file"
    data-status={upload.status}
    data-leaving={leaving}
    inert={leaving}
    title={upload.name}
    onAnimationEnd={leave_end(leaving, on_left)}
  >
    <span className="composer-media-frame">
      <span className="composer-media-file-icon">
        <FileTextIcon />
      </span>
      <span className="composer-media-file-name">
        <span>{upload.name}</span>
      </span>
    </span>
    <RemoveButton name={upload.name} on_remove={on_remove} />
  </div>
);

export const ComposerMedia = ({ draft_key, uploads }: { draft_key: string; uploads: DraftUpload[] }) => {
  const [open, set_open] = useState<LightboxImage | null>(null);
  const entries = useMemo(() => uploads.map((upload) => ({ id: upload.key, upload })), [uploads]);
  const { rows, finish } = use_leaving_rows(entries);
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="composer-media">
      {rows.map(({ item, leaving }) => {
        const tile = { upload: item.upload, leaving, on_left: () => finish(item.id), on_remove: () => discard_upload(draft_key, item.id) };
        return item.upload.image ? <ImageTile key={item.id} {...tile} on_open={set_open} /> : <FileTile key={item.id} {...tile} />;
      })}
      <Lightbox image={open} on_close={() => set_open(null)} />
    </div>
  );
};
