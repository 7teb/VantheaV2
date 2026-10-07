import { CircleAlertIcon, CloseIcon, FileTextIcon } from "../../components/icons.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { use_t } from "../../i18n/index.ts";
import type { DraftUpload } from "../../state/chat-drafts.ts";
import { discard_upload } from "../../state/composer.ts";
import { attachment_src, format_size } from "../chat/media.ts";

const Preview = ({ upload }: { upload: DraftUpload }) => {
  if (upload.status === "uploading") {
    return <Skeleton width={28} height={28} radius={7} />;
  }
  if (upload.status === "failed") {
    return <CircleAlertIcon size={16} />;
  }
  if (upload.image && upload.attachment) {
    return <img className="attachment-chip-thumb" src={attachment_src(upload.attachment)} alt="" />;
  }
  return <FileTextIcon size={16} />;
};

export const AttachmentChips = ({ draft_key, uploads }: { draft_key: string; uploads: DraftUpload[] }) => {
  const t = use_t();
  if (uploads.length === 0) {
    return null;
  }
  return (
    <div className="attachment-chips">
      {uploads.map((upload) => (
        <div key={upload.key} className="attachment-chip" data-status={upload.status} title={upload.error || upload.name}>
          <span className="attachment-chip-preview">
            <Preview upload={upload} />
          </span>
          <span className="attachment-chip-text">
            <span className="attachment-chip-name">{upload.name}</span>
            <span className="attachment-chip-meta">{upload.status === "failed" ? upload.error : format_size(upload.size)}</span>
          </span>
          <button
            type="button"
            className="attachment-chip-remove"
            aria-label={t(upload.image ? "composer.remove_image" : "composer.remove_file")}
            onClick={() => discard_upload(draft_key, upload.key)}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};
