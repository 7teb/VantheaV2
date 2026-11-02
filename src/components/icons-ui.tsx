import { class_names } from "./class-names.ts";
import { codicon, Icon, lucide, phosphor, type IconProps } from "./icons-base.tsx";

export const ArrowUpIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M13.854 7l-5-5h-.707l-5 5 .707.707L8 3.561V14h1V3.56l4.146 4.147.708-.707z" />
  </Icon>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M7 3.093l-5 5V8.8l5 5 .707-.707-4.146-4.147H14v-1H3.56L7.708 3.8 7 3.093z" />
  </Icon>
);

export const BellIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.5 13.5a1 1 0 0 0 2 0" />
    <path d="M2.5 11.5h10c-.9-.9-1.5-1.9-1.5-4.5a3.5 3.5 0 0 0-7 0c0 2.6-.6 3.6-1.5 4.5z" />
  </Icon>
);

export const MicIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M5.50012 8.5V4.5C5.50012 3.11929 6.61941 2 8.00012 2C9.38083 2 10.5001 3.11929 10.5001 4.5V8.5C10.5001 9.88071 9.38083 11 8.00012 11C6.61941 11 5.50012 9.88071 5.50012 8.5ZM8.00012 1C6.06713 1 4.50012 2.567 4.50012 4.5V8.5C4.50012 10.433 6.06713 12 8.00012 12C9.93312 12 11.5001 10.433 11.5001 8.5V4.5C11.5001 2.567 9.93312 1 8.00012 1Z" />
    <path fillRule="evenodd" clipRule="evenodd" d="M7.50012 16V14H8.50012V16H7.50012Z" />
    <path fillRule="evenodd" clipRule="evenodd" d="M7.50012 14C4.7387 14 2.50012 11.7614 2.50012 9H3.50012C3.50012 11.2091 5.29098 13 7.50012 13H8.50012C10.7093 13 12.5001 11.2091 12.5001 9H13.5001C13.5001 11.7614 11.2615 14 8.50012 14H7.50012Z" />
  </Icon>
);

export const StopIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M13 1.99976L14 2.99976V12.9998L13 13.9998H3L2 12.9998L2 2.99976L3 1.99976H13ZM12.7461 3.25057L3.25469 3.25057L3.25469 12.7504H12.7461V3.25057Z" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M13 7v1H8v5H7V8H2V7h5V2h1v5h5z" />
  </Icon>
);

export const PlusSmallIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M12 7v1H8v4H7V8H3V7h4V3h1v4h4z" />
  </Icon>
);

export const MinusIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M3 7h9v1H3z" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...lucide} {...props}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
  </Icon>
);

export const CloseSmallIcon = (props: IconProps) => (
  <Icon strokeWidth={1.5} {...props}>
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
  </Icon>
);

export const ChevronDownIcon = ({ className, ...props }: IconProps) => (
  <Icon strokeWidth={1.5} className={class_names("chevron-icon", className)} {...props}>
    <path d="M5 6.5l3 3 3-3" />
  </Icon>
);

export const ChevronUpIcon = ({ className, ...props }: IconProps) => (
  <Icon strokeWidth={1.5} className={class_names("chevron-icon", className)} {...props}>
    <path d="M5 9.5l3-3 3 3" />
  </Icon>
);

export const ChevronLeftIcon = ({ className, ...props }: IconProps) => (
  <Icon strokeWidth={1.5} className={class_names("chevron-icon", className)} {...props}>
    <path d="M9.5 5l-3 3 3 3" />
  </Icon>
);

export const ChevronRightIcon = ({ className, ...props }: IconProps) => (
  <Icon strokeWidth={1.5} className={class_names("chevron-icon", className)} {...props}>
    <path d="M6.5 5l3 3-3 3" />
  </Icon>
);

export const NavLeftIcon = (props: IconProps) => (
  <Icon strokeWidth={1.5} {...props}>
    <path d="M10 4l-4 4 4 4" />
  </Icon>
);

export const NavRightIcon = (props: IconProps) => (
  <Icon strokeWidth={1.5} {...props}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 2.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM6.67 9.33 2.5 13.5" />
  </Icon>
);

export const ComposeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7.5 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5V8.5M6.5 9.5v-2L12 2l2 2-5.5 5.5zM10.5 3.5l2 2" />
  </Icon>
);

export const PencilIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z" />
  </Icon>
);

export const PencilLineIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z" />
  </Icon>
);

export const PinIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M14 5v7h-.278c-.406 0-.778-.086-1.117-.258A2.528 2.528 0 0 1 11.73 11H8.87a3.463 3.463 0 0 1-.546.828 3.685 3.685 0 0 1-.735.633c-.27.177-.565.31-.882.398a3.875 3.875 0 0 1-.985.141h-.5V9H2l-1-.5L2 8h3.222V4h.5c.339 0 .664.047.977.14.312.094.607.227.883.4A3.404 3.404 0 0 1 8.87 6h2.859a2.56 2.56 0 0 1 .875-.734c.338-.172.71-.26 1.117-.266H14zm-.778 1.086a1.222 1.222 0 0 0-.32.156 1.491 1.491 0 0 0-.43.461L12.285 7H8.183l-.117-.336a2.457 2.457 0 0 0-.711-1.047C7.027 5.331 6.427 5.09 6 5v7c.427-.088 1.027-.33 1.355-.617.328-.287.565-.636.71-1.047L8.184 10h4.102l.18.297c.057.094.122.177.195.25.073.073.153.143.242.21.088.069.195.12.32.157V6.086z" />
  </Icon>
);

export const PinOffIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M4 2h7v.278c0 .406-.086.778-.258 1.117-.172.339-.42.63-.742.875v2.86c.307.145.583.328.828.546.245.219.456.464.633.735.177.27.31.565.398.882.089.318.136.646.141.985v.5H8V14l-.5 1-.5-1v-3.222H3v-.5c0-.339.047-.664.14-.977.094-.312.227-.607.4-.883A3.404 3.404 0 0 1 5 7.13V4.27a2.561 2.561 0 0 1-.734-.875A2.505 2.505 0 0 1 4 2.278V2zm1.086.778c.042.125.094.232.156.32a1.494 1.494 0 0 0 .461.43L6 3.715v4.102l-.336.117c-.411.146-.76.383-1.047.711C4.331 8.973 4.09 9.573 4 10h7c-.088-.427-.33-1.027-.617-1.355a2.456 2.456 0 0 0-1.047-.71L9 7.816V3.715l.297-.18c.094-.057.177-.122.25-.195a2.28 2.28 0 0 0 .21-.242.968.968 0 0 0 .157-.32H5.086z" />
  </Icon>
);

export const MoreHorizontalIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M2 7h2v2H2zm5 0h2v2H7zm5 0h2v2h-2z" />
  </Icon>
);

export const MoreVerticalIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M7 2h2v2H7zm0 5h2v2H7zm0 5h2v2H7z" />
  </Icon>
);

export const PanelLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5zM5.5 2.5v11" />
  </Icon>
);

export const PanelRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5zM10.5 2.5v11" />
  </Icon>
);

export const SettingsIcon = (props: IconProps) => (
  <Icon {...lucide} {...props}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const SlidersIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M6 9.5C6.93191 9.5 7.71496 10.1374 7.93699 11H13.5C13.7761 11 14 11.2239 14 11.5C14 11.7455 13.8231 11.9496 13.5899 11.9919L13.5 12L7.93673 12.001C7.71435 12.8631 6.93155 13.5 6 13.5C5.06845 13.5 4.28565 12.8631 4.06327 12.001L2.5 12C2.22386 12 2 11.7761 2 11.5C2 11.2545 2.17688 11.0504 2.41012 11.0081L2.5 11H4.06301C4.28504 10.1374 5.06809 9.5 6 9.5ZM6 10.5C5.44772 10.5 5 10.9477 5 11.5C5 12.0523 5.44772 12.5 6 12.5C6.55228 12.5 7 12.0523 7 11.5C7 10.9477 6.55228 10.5 6 10.5ZM10 2.5C10.9319 2.5 11.715 3.13738 11.937 3.99998L13.5 4C13.7761 4 14 4.22386 14 4.5C14 4.74546 13.8231 4.94961 13.5899 4.99194L13.5 5L11.9367 5.00102C11.7144 5.86312 10.9316 6.5 10 6.5C9.06845 6.5 8.28565 5.86312 8.06327 5.00102L2.5 5C2.22386 5 2 4.77614 2 4.5C2 4.25454 2.17688 4.05039 2.41012 4.00806L2.5 4L8.06301 3.99998C8.28504 3.13738 9.06809 2.5 10 2.5ZM10 3.5C9.44772 3.5 9 3.94772 9 4.5C9 5.05228 9.44772 5.5 10 5.5C10.5523 5.5 11 5.05228 11 4.5C11 3.94772 10.5523 3.5 10 3.5Z" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z" />
    <path fillRule="evenodd" clipRule="evenodd" d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z" />
  </Icon>
);

export const UndoIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M3.5 2v3.5L4 6h3.5V5H4.979l.941-.941a3.552 3.552 0 1 1 5.023 5.023L5.746 14.28l.72.72 5.198-5.198A4.57 4.57 0 0 0 5.2 3.339l-.7.7V2h-1z" />
  </Icon>
);

export const RetryIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M4 15v-1c2 0 2-.6 2-1H1.5l-.5-.5v-10l.5-.5h13l.5.5v9.24l-1-1V3H2v9h5.73l-.5.5 2.5 2.5H4zm7.86 0l2.5-2.5-.71-.7L12 13.45V7h-1v6.44l-1.64-1.65-.71.71 2.5 2.5h.71z" />
  </Icon>
);

export const ExpandIcon = (props: IconProps) => (
  <Icon {...lucide} {...props}>
    <path d="M15 3h6v6M21 3l-7 7M3 21l7-7M9 21H3v-6" />
  </Icon>
);

export const ShrinkIcon = (props: IconProps) => (
  <Icon {...lucide} {...props}>
    <path d="M14 10l7-7M20 10h-6V4M3 21l7-7M4 14h6v6" />
  </Icon>
);

export const KeyIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M11.351 1.091a4.528 4.528 0 0 1 3.44 3.16c.215.724.247 1.49.093 2.23a4.583 4.583 0 0 1-4.437 3.6c-.438 0-.874-.063-1.293-.19l-.8.938-.379.175H7v1.5l-.5.5H5v1.5l-.5.5h-3l-.5-.5v-2.307l.146-.353L6.12 6.87a4.464 4.464 0 0 1-.2-1.405 4.528 4.528 0 0 1 5.431-4.375zm1.318 7.2a3.568 3.568 0 0 0 1.239-2.005l.004.005A3.543 3.543 0 0 0 9.72 2.08a3.576 3.576 0 0 0-2.8 3.4c-.01.456.07.908.239 1.33l-.11.543L2 12.404v1.6h2v-1.5l.5-.5H6v-1.5l.5-.5h1.245l.876-1.016.561-.14a3.47 3.47 0 0 0 1.269.238 3.568 3.568 0 0 0 2.218-.795zm-.838-2.732a1 1 0 1 0-1.662-1.11 1 1 0 0 0 1.662 1.11z" />
  </Icon>
);

export const MessageSquareIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M14.5 2h-13l-.5.5v9l.5.5H4v2.5l.854.354L7.707 12H14.5l.5-.5v-9l-.5-.5zm-.5 9H7.5l-.354.146L5 13.293V11.5l-.5-.5H2V3h12v8z" />
  </Icon>
);

export const ForkIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M14 4a2 2 0 1 0-2.47 1.94V7a.48.48 0 0 1-.27.44L8.49 8.88l-2.76-1.4A.49.49 0 0 1 5.46 7V5.94a2 2 0 1 0-1 0V7a1.51 1.51 0 0 0 .82 1.34L8 9.74v1.32a2 2 0 1 0 1 0V9.74l2.7-1.36A1.49 1.49 0 0 0 12.52 7V5.92A2 2 0 0 0 14 4zM4 4a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm5.47 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM12 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
  </Icon>
);

export const CornerDownRightIcon = (props: IconProps) => (
  <Icon {...phosphor} viewBox="0 -16 288 288" {...props}>
    <path d="M221.66,181.66l-48,48a8,8,0,0,1-11.32-11.32L196.69,184H72a8,8,0,0,1-8-8V32a8,8,0,0,1,16,0V168H196.69l-34.35-34.34a8,8,0,0,1,11.32-11.32l48,48A8,8,0,0,1,221.66,181.66Z" />
  </Icon>
);

export const UserIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path d="M16 7.992C16 3.58 12.416 0 8 0S0 3.58 0 7.992c0 2.43 1.104 4.62 2.832 6.09.016.016.032.016.032.032.144.112.288.224.448.336.08.048.144.111.224.175A7.98 7.98 0 0 0 8.016 16a7.98 7.98 0 0 0 4.48-1.375c.08-.048.144-.111.224-.16.144-.111.304-.223.448-.335.016-.016.032-.016.032-.032 1.696-1.487 2.8-3.676 2.8-6.106zm-8 7.001c-1.504 0-2.88-.48-4.016-1.279.016-.128.048-.255.08-.383a4.17 4.17 0 0 1 .416-.991c.176-.304.384-.576.64-.816.24-.24.528-.463.816-.639.304-.176.624-.304.976-.4A4.15 4.15 0 0 1 8 10.342a4.185 4.185 0 0 1 2.928 1.166c.368.368.656.8.864 1.295.112.288.192.592.24.911A7.03 7.03 0 0 1 8 14.993zm-2.448-7.4a2.49 2.49 0 0 1-.208-1.024c0-.351.064-.703.208-1.023.144-.32.336-.607.576-.847.24-.24.528-.431.848-.575.32-.144.672-.208 1.024-.208.368 0 .704.064 1.024.208.32.144.608.336.848.575.24.24.432.528.576.847.144.32.208.672.208 1.023 0 .368-.064.704-.208 1.023a2.84 2.84 0 0 1-.576.848 2.84 2.84 0 0 1-.848.575 2.715 2.715 0 0 1-2.064 0 2.84 2.84 0 0 1-.848-.575 2.526 2.526 0 0 1-.56-.848zm7.424 5.306c0-.032-.016-.048-.016-.08a5.22 5.22 0 0 0-.688-1.406 4.883 4.883 0 0 0-1.088-1.135 5.207 5.207 0 0 0-1.04-.608 2.82 2.82 0 0 0 .464-.383 4.2 4.2 0 0 0 .624-.784 3.624 3.624 0 0 0 .528-1.934 3.71 3.71 0 0 0-.288-1.47 3.799 3.799 0 0 0-.816-1.199 3.845 3.845 0 0 0-1.2-.8 3.72 3.72 0 0 0-1.472-.287 3.72 3.72 0 0 0-1.472.288 3.631 3.631 0 0 0-1.2.815 3.84 3.84 0 0 0-.8 1.199 3.71 3.71 0 0 0-.288 1.47c0 .352.048.688.144 1.007.096.336.224.64.4.927.16.288.384.544.624.784.144.144.304.271.48.383a5.12 5.12 0 0 0-1.04.624c-.416.32-.784.703-1.088 1.119a4.999 4.999 0 0 0-.688 1.406c-.016.032-.016.064-.016.08C1.776 11.636.992 9.91.992 7.992.992 4.14 4.144.991 8 .991s7.008 3.149 7.008 7.001a6.96 6.96 0 0 1-2.032 4.907z" />
  </Icon>
);

export const SmileIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M4.111 2.18a7 7 0 1 1 7.778 11.64A7 7 0 0 1 4.11 2.18zm.556 10.809a6 6 0 1 0 6.666-9.978 6 6 0 0 0-6.666 9.978zM6.5 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM8 11a3 3 0 0 1-2.65-1.58l-.87.48a4 4 0 0 0 7.12-.16l-.9-.43A3 3 0 0 1 8 11z" />
  </Icon>
);

export const SmartphoneIcon = (props: IconProps) => (
  <Icon {...codicon} {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M4.5 1h8l.5.5v13l-.5.5h-8l-.5-.5v-13l.5-.5zM5 14h7V2H5v12zm2.5-2h2v1h-2v-1z" />
  </Icon>
);

export const SkipForwardIcon = (props: IconProps) => (
  <Icon {...lucide} {...props}>
    <path d="M21 4v16" />
    <path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z" />
  </Icon>
);
