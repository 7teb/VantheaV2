import { codicon, Icon, phosphor, type IconProps } from "./icons-base.tsx";

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
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M1 3l1-1h12l1 1v6h-1V3H2v8h5v1H2l-1-1V3zm14.707 9.707L9 6v9.414l2.707-2.707h4zM10 13V8.414l3.293 3.293h-2L10 13z" />
  </Icon>
);

export const MousePointerClickIcon = (props: IconProps) => (
  <Icon {...phosphor} viewBox="-1.6 -1.6 236.8 236.8" strokeWidth={1.988} {...props}>
    <path d="M88,24V16a8,8,0,0,1,16,0v8a8,8,0,0,1-16,0ZM16,104h8a8,8,0,0,0,0-16H16a8,8,0,0,0,0,16ZM124.42,39.16a8,8,0,0,0,10.74-3.58l8-16a8,8,0,0,0-14.31-7.16l-8,16A8,8,0,0,0,124.42,39.16Zm-96,81.69-16,8a8,8,0,0,0,7.16,14.31l16-8a8,8,0,1,0-7.16-14.31ZM219.31,184a16,16,0,0,1,0,22.63l-12.68,12.68a16,16,0,0,1-22.63,0L132.7,168,115,214.09c0,.1-.08.21-.13.32a15.83,15.83,0,0,1-14.6,9.59l-.79,0a15.83,15.83,0,0,1-14.41-11L32.8,52.92A16,16,0,0,1,52.92,32.8L213,85.07a16,16,0,0,1,1.41,29.8l-.32.13L168,132.69ZM208,195.31,156.69,144h0a16,16,0,0,1,4.93-26l.32-.14,45.95-17.64L48,48l52.2,159.86,17.65-46c0-.11.08-.22.13-.33a16,16,0,0,1,11.69-9.34,16.72,16.72,0,0,1,3-.28,16,16,0,0,1,11.3,4.69L195.31,208Z" />
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
  <Icon {...codicon} strokeWidth={0} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M14 3H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm0 8H3V4h11v7zm-3-6h-1v1h1V5zm-1 2H9v1h1V7zm2-2h1v1h-1V5zm1 4h-1v1h1V9zM6 9h5v1H6V9zm7-2h-2v1h2V7zM8 5h1v1H8V5zm0 2H7v1h1V7zM4 9h1v1H4V9zm0-4h1v1H4V5zm3 0H6v1h1V5zM4 7h2v1H4V7z" />
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
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M10.707 3H14.5l.5.5v9l-.5.5h-13l-.5-.5v-9l.5-.5h3.793l.853-.854L6.5 2h3l.354.146.853.854zM2 12h12V4h-3.5l-.354-.146L9.293 3H6.707l-.853.854L5.5 4H2v8zm1.5-7a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0-1a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
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
