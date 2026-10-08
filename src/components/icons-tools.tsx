import { Icon, type IconProps } from "./icons-base.tsx";

const shield =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

export const TerminalIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4 17 6-6-6-6" />
    <path d="M12 19h8" />
  </Icon>
);

export const SquareTerminalIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m7 11 2-2-2-2" />
    <path d="M11 13h4" />
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </Icon>
);

export const GlobeIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </Icon>
);

export const GlobeCheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m15 6 2 2 4-4" />
    <path d="M2 12h20A10 10 0 1 1 12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 4-10" />
  </Icon>
);

export const AtSignIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
  </Icon>
);

export const PlugIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </Icon>
);

export const WorkflowIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="8" height="8" rx="2" />
    <path d="M7 11v4a2 2 0 0 0 2 2h4" />
    <rect x="13" y="13" width="8" height="8" rx="2" />
  </Icon>
);

export const GitBranchPlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 3v12" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M15 6a9 9 0 0 0-9 9" />
    <path d="M18 15v6" />
    <path d="M21 18h-6" />
  </Icon>
);

export const BotIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 8V4H8" />
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </Icon>
);

export const WormIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m19 12-1.5 3" />
    <path d="M19.63 18.81 22 20" />
    <path d="M6.47 8.23a1.68 1.68 0 0 1 2.44 1.93l-.64 2.08a6.76 6.76 0 0 0 10.16 7.67l.42-.27a1 1 0 1 0-2.73-4.21l-.42.27a1.76 1.76 0 0 1-2.63-1.99l.64-2.08A6.66 6.66 0 0 0 3.94 3.9l-.7.4a1 1 0 1 0 2.55 4.34z" />
  </Icon>
);

export const CombineIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" />
    <path d="M19 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" />
    <path d="m7 15 3 3" />
    <path d="m7 21 3-3H5a2 2 0 0 1-2-2v-2" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="3" width="7" height="7" rx="1" />
  </Icon>
);

export const CloudAlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 12v4" />
    <path d="M12 20h.01" />
    <path d="M8.128 16.949A7 7 0 1 1 15.71 8h1.79a1 1 0 0 1 0 9h-1.642" />
  </Icon>
);

export const LightbulbIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
    <path d="M9 18h6" />
    <path d="M10 22h4" />
  </Icon>
);

export const HandIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
    <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </Icon>
);

export const ShieldCheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d={shield} />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const ShieldAlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d={shield} />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Icon>
);

export const ShapesIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <circle cx="17.5" cy="17.5" r="3.5" />
  </Icon>
);

export const PaletteIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
    <circle cx="13.5" cy="6.5" r=".75" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="10.5" r=".75" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="12.5" r=".75" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="7.5" r=".75" fill="currentColor" stroke="none" />
  </Icon>
);

export const LineSquiggleIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 3.5c5-2 7 2.5 3 4C1.5 10 2 15 5 16c5 2 9-10 14-7s.5 13.5-4 12c-5-2.5.5-11 6-2" />
  </Icon>
);

export const CoinsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
    <path d="M7 6h1v4" />
    <path d="m16.71 13.88.7.71-2.82 2.82" />
  </Icon>
);

export const CalendarClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
    <path d="M16 2v4" />
    <path d="M8 2v4" />
    <path d="M3 10h5" />
    <path d="M17.5 17.5 16 16.3V14" />
    <circle cx="16" cy="16" r="6" />
  </Icon>
);
