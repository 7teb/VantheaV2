import { useState } from "react";
import type { Attachment } from "../../../shared/chat.ts";
import { FileTextIcon } from "../../components/icons.tsx";
import { Lightbox, type LightboxImage } from "./Lightbox.tsx";
import { attachment_src, format_size } from "./media.ts";
import { MediaImage } from "./MediaImage.tsx";

export const UserAttachments = ({ attachments }: { attachments: Attachment[] }) => {
  const [open, set_open] = useState<LightboxImage | null>(null);
  return (
    <div className="user-attachments">
      {attachments.map((attachment) =>
        attachment.kind === "image" ? (
          <MediaImage
            key={attachment.id}
            src={attachment_src(attachment)}
            alt={attachment.name}
            className="user-attachment-image"
            on_open={() => set_open({ src: attachment_src(attachment), alt: attachment.name })}
          />
        ) : (
          <div key={attachment.id} className="user-attachment-file inset-surface" title={attachment.name}>
            <FileTextIcon size={16} />
            <span className="user-attachment-name">{attachment.name}</span>
            <span className="user-attachment-size">{format_size(attachment.size)}</span>
          </div>
        ),
      )}
      <Lightbox image={open} on_close={() => set_open(null)} />
    </div>
  );
};
