import { Icon, type IconProps } from "./icons-base.tsx";

const folder = "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z";

export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d={folder} />
  </Icon>
);

export const FolderOpenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </Icon>
);

export const FolderPlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d={folder} />
    <path d="M12 10v6" />
    <path d="M9 13h6" />
  </Icon>
);

export const FolderXIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d={folder} />
    <path d="m9.5 10.5 5 5" />
    <path d="m14.5 10.5-5 5" />
  </Icon>
);

export const FolderSearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d={folder} />
    <circle cx="11.5" cy="12.5" r="2.5" />
    <path d="M13.3 14.3 15 16" />
  </Icon>
);

export const FoldersIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 17a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.9a2 2 0 0 1-1.69-.9l-.81-1.2a2 2 0 0 0-1.67-.9H8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z" />
    <path d="M2 8v11a2 2 0 0 0 2 2h14" />
  </Icon>
);

export const FileTextIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    <path d="M10 9H8" />
  </Icon>
);

export const FilePenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
  </Icon>
);

export const FileDiffIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M12 8v3" />
    <path d="M10.5 9.5h3" />
    <path d="M9 15h6" />
  </Icon>
);

export const SummaryIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 4H7" />
    <path d="m18 16 3 3-3 3" />
    <path d="M3 4v13a2 2 0 0 0 2 2h16" />
    <path d="M7 14h7" />
    <path d="M7 9h12" />
  </Icon>
);

export const OutlineIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 8h7" />
    <path d="M8 12h6" />
    <path d="M11 16h5" />
  </Icon>
);

export const ScrollTextIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 12h-5" />
    <path d="M15 8h-5" />
    <path d="M19 17V5a2 2 0 0 0-2-2H4" />
    <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
  </Icon>
);

export const PaperclipIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.09 8.3v6.7a2.09 2.09 0 0 1-4.18 0V6.58a4.18 4.18 0 0 1 8.36 0v8.17a6.27 6.27 0 0 1-12.54 0V8.4" />
  </Icon>
);

export const ImageIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </Icon>
);
