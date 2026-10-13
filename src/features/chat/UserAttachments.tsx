import { useState } from "react";
import type { Attachment } from "../../../shared/chat.ts";
import { FileTextIcon } from "../../components/icons.tsx";
import { Lightbox, type LightboxImage } from "./Lightbox.tsx";
import { attachment_src, attachment_thumb_src, format_size } from "./media.ts";
import { MediaImage } from "./MediaImage.tsx";

export const UserAttachments = ({ attachments }: { attachments: Attachment[] }) => {
  const [open, set_open] = useState<LightboxImage | null>(null);
  const images = attachments.filter((attachment) => attachment.kind === "image");
  const files = attachments.filter((attachment) => attachment.kind !== "image");
  return (
    <>
      {images.length > 0 && (
        <div className="user-attachments">
          <div className="user-attachments-row">
            {images.map((attachment) => (
              <MediaImage
                key={attachment.id}
                src={attachment_thumb_src(attachment)}
                alt={attachment.name}
                className="user-attachment-image"
                on_open={() => set_open({ src: attachment_src(attachment), alt: attachment.name })}
              />
            ))}
          </div>
        </div>
      )}
      {files.length > 0 && (
        <div className="user-attachment-files">
          {files.map((attachment) => (
            <div key={attachment.id} className="user-attachment-file inset-surface" title={attachment.name}>
              <FileTextIcon size={16} />
              <span className="user-attachment-name">{attachment.name}</span>
              <span className="user-attachment-size">{format_size(attachment.size)}</span>
            </div>
          ))}
        </div>
      )}
      <Lightbox image={open} on_close={() => set_open(null)} />
    </>
  );
};
