import { Icon, type IconProps } from "./icons-base.tsx";

export const GitBranchIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 6a9 9 0 0 0-9 9V3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
  </Icon>
);

export const GitCommitIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M3 12h6" />
    <path d="M15 12h6" />
  </Icon>
);

export const AheadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 19V6" />
    <path d="m6 12 6-6 6 6" />
  </Icon>
);

export const BehindIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v13" />
    <path d="m18 12-6 6-6-6" />
  </Icon>
);

export const ExternalLinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
);

export const GitMergeIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M6 21V9a9 9 0 0 0 9 9" />
  </Icon>
);

export const HistoryIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </Icon>
);

export const TagIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
    <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
  </Icon>
);

export const CloudOffIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057" />
    <path d="M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78" />
    <path d="m2 2 20 20" />
  </Icon>
);

export const GitPullRequestIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <path d="M6 9v12" />
  </Icon>
);

export const GitPullRequestDraftIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M18 6V5" />
    <path d="M18 11v-1" />
    <path d="M6 9v12" />
  </Icon>
);

export const GitPullRequestClosedIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="m15 3 6 6" />
    <path d="m15 9 6-6" />
    <path d="M18 12v3" />
    <path d="M6 9v12" />
  </Icon>
);

export const CircleXIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6" />
    <path d="m9 9 6 6" />
  </Icon>
);

export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);

export const LockOpenIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </Icon>
);

export const WorktreeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18 19a5 5 0 0 1-5-5v8" />
    <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
    <circle cx="13" cy="12" r="2" />
    <circle cx="20" cy="19" r="2" />
  </Icon>
);

export const PushIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m18 9-6-6-6 6" />
    <path d="M12 3v14" />
    <path d="M5 21h14" />
  </Icon>
);

export const GitCompareIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5" cy="6" r="3" />
    <path d="M12 6h5a2 2 0 0 1 2 2v7" />
    <path d="m15 9-3-3 3-3" />
    <circle cx="19" cy="18" r="3" />
    <path d="M12 18H7a2 2 0 0 1-2-2V9" />
    <path d="m9 15 3 3-3 3" />
  </Icon>
);
