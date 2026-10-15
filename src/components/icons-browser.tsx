import { Icon, type IconProps } from "./icons-base.tsx";

const scan_corners = (
  <>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  </>
);

export const AppWindowIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M10 4v4" />
    <path d="M2 8h20" />
    <path d="M6 4v4" />
  </Icon>
);

export const CompassIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
    <circle cx="12" cy="12" r="10" />
  </Icon>
);

export const ScanTextIcon = (props: IconProps) => (
  <Icon {...props}>
    {scan_corners}
    <path d="M7 8h8" />
    <path d="M7 12h10" />
    <path d="M7 16h6" />
  </Icon>
);

export const ScanEyeIcon = (props: IconProps) => (
  <Icon {...props}>
    {scan_corners}
    <circle cx="12" cy="12" r="1" />
    <path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0" />
  </Icon>
);

export const MousePointerClickIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 4.1 12 6" />
    <path d="m5.1 8-2.9-.8" />
    <path d="m6 12-1.9 2" />
    <path d="M7.2 2.2 8 5.1" />
    <path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" />
  </Icon>
);

export const TextCursorInputIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 4h1a3 3 0 0 1 3 3 3 3 0 0 1 3-3h1" />
    <path d="M13 20h-1a3 3 0 0 1-3-3 3 3 0 0 1-3 3H5" />
    <path d="M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1" />
    <path d="M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7" />
    <path d="M9 7v10" />
  </Icon>
);

export const KeyboardIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 8h.01" />
    <path d="M12 12h.01" />
    <path d="M14 8h.01" />
    <path d="M16 12h.01" />
    <path d="M18 8h.01" />
    <path d="M6 8h.01" />
    <path d="M7 16h10" />
    <path d="M8 12h.01" />
    <rect x="2" y="4" width="20" height="16" rx="2" />
  </Icon>
);

export const MouseIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="2" width="14" height="20" rx="7" />
    <path d="M12 6v4" />
  </Icon>
);

export const HourglassIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 22h14" />
    <path d="M5 2h14" />
    <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
    <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
  </Icon>
);

export const CameraIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </Icon>
);

export const MonitorCheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 10 2 2 4-4" />
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M12 17v4" />
    <path d="M8 21h8" />
  </Icon>
);

export const LogsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 5h1" />
    <path d="M3 12h1" />
    <path d="M3 19h1" />
    <path d="M8 5h1" />
    <path d="M8 12h1" />
    <path d="M8 19h1" />
    <path d="M13 5h8" />
    <path d="M13 12h8" />
    <path d="M13 19h8" />
  </Icon>
);

export const BracesIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
    <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
  </Icon>
);
