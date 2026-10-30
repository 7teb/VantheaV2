import type { ReactNode } from "react";
import { remote_client } from "../../../api/bridge.ts";
import { IconButton } from "../../../components/Button.tsx";
import { FolderOpenIcon } from "../../../components/icons.tsx";
import { CopyButton } from "../../../components/MarkdownCopy.tsx";
import { SkeletonLines } from "../../../components/Skeleton.tsx";
import { use_t } from "../../../i18n/index.ts";
import { reveal_file } from "../../../state/files.ts";

type PathBarProps = { path: string; meta: ReactNode; on_disk?: boolean };

export const PathBar = ({ path, meta, on_disk = true }: PathBarProps) => {
  const t = use_t();
  return (
    <div className="files-path">
      <span className="files-path-text">{path}</span>
      <span className="files-path-meta">{meta}</span>
      <CopyButton text={path} label={t("files.copy_path")} />
      {on_disk && !remote_client && (
        <IconButton label={t("files.reveal")} size="sm" onClick={() => void reveal_file(path)}>
          <FolderOpenIcon size={14} />
        </IconButton>
      )}
    </div>
  );
};

export const ViewerSkeleton = () => (
  <div className="files-viewer-skeleton" aria-busy="true">
    <SkeletonLines widths={[38, 64, 52, 80, 46, 72, 58, 34]} height={11} gap={9} />
  </div>
);
