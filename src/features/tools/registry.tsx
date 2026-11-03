import type { ComponentType } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { is_shell_run } from "../../../shared/shell.ts";
import type { ToolView, ToolViewKind } from "../../../shared/tool-view.ts";
import {
  AppWindowIcon,
  BookOpenIcon,
  BracesIcon,
  CameraIcon,
  ChartPieIcon,
  CircleHelpIcon,
  ClipboardListIcon,
  GaugeIcon,
  ClockIcon,
  CoinsIcon,
  CompassIcon,
  CritterMark,
  FilePenIcon,
  GlobeCheckIcon,
  GlobeIcon,
  HookIcon,
  HourglassIcon,
  ImageIcon,
  KeyboardIcon,
  LayersIcon,
  LogsIcon,
  ListChecksIcon,
  MessageSquareIcon,
  MonitorCheckIcon,
  MouseIcon,
  MousePointerClickIcon,
  OutlineIcon,
  PlugIcon,
  ScanEyeIcon,
  ScanTextIcon,
  SearchIcon,
  ShieldTerminalIcon,
  SquareDollarIcon,
  SquareTerminalIcon,
  SummaryIcon,
  TextCursorInputIcon,
  WorkflowIcon,
  WormIcon,
  type IconComponent,
} from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { AgentBody, BackgroundBody, CommandBody } from "./bodies-run.tsx";
import { EditBody, FilesBody, GrepBody, OutlineBody } from "./bodies-files.tsx";
import { HooksBody } from "./bodies-hooks.tsx";
import { ModelsBody } from "./bodies-models.tsx";
import { ImageBody, WebSearchBody } from "./bodies-web.tsx";
import { McpBody, MemoryBody, PeerMessageBody, PlanBody, TextBody } from "./bodies-work.tsx";
import type { BodyProps } from "./body-types.ts";
import { DraftCode } from "./DraftCode.tsx";
import { hook_blocked, step_hooks } from "./hook-runs.ts";
import { BlockedCall, HookRuns } from "./HookRuns.tsx";
import { live_draft } from "./live-draft.ts";
import { LiveCommand } from "./LiveCommand.tsx";
import { OutputBlock } from "./OutputBlock.tsx";
import { is_reviewing } from "./review-phase.ts";
import { ReviewNotice } from "./ReviewNote.tsx";
import { ReviewBody } from "./ReviewPending.tsx";
import { denial_note, live_command, shown_error, view_content } from "./tool-body.ts";
import { tool_meta } from "./tool-meta.ts";
import type { ToolIconName } from "./tool-meta-types.ts";

export const tool_icons: Record<ToolIconName, IconComponent> = {
  terminal: SquareTerminalIcon,
  bash: SquareDollarIcon,
  background: LayersIcon,
  file: BookOpenIcon,
  files: SummaryIcon,
  search: SearchIcon,
  outline: OutlineIcon,
  edit: FilePenIcon,
  todos: ListChecksIcon,
  plan: ClipboardListIcon,
  web: GlobeCheckIcon,
  image: ImageIcon,
  agent: CritterMark,
  workflow: WorkflowIcon,
  memory: WormIcon,
  hook: HookIcon,
  skill: BookOpenIcon,
  browser: GlobeIcon,
  browser_tabs: AppWindowIcon,
  browser_navigate: CompassIcon,
  browser_snapshot: ScanTextIcon,
  browser_console: LogsIcon,
  browser_eval: BracesIcon,
  browser_click: MousePointerClickIcon,
  browser_type: TextCursorInputIcon,
  browser_key: KeyboardIcon,
  browser_scroll: MouseIcon,
  browser_wait: HourglassIcon,
  browser_screenshot: CameraIcon,
  browser_look: ScanEyeIcon,
  page_check: MonitorCheckIcon,
  mcp: PlugIcon,
  clock: ClockIcon,
  gauge: GaugeIcon,
  models: CoinsIcon,
  question: CircleHelpIcon,
  visual: ChartPieIcon,
  text: MessageSquareIcon,
};

type Bodies = { [K in ToolViewKind]?: ComponentType<BodyProps<K>> };

export const view_bodies: Bodies = {
  files: FilesBody,
  grep: GrepBody,
  outline: OutlineBody,
  edit: EditBody,
  command: CommandBody,
  background: BackgroundBody,
  agent: AgentBody,
  peer_message: PeerMessageBody,
  plan: PlanBody,
  web_search: WebSearchBody,
  image: ImageBody,
  mcp: McpBody,
  memory: MemoryBody,
  hooks: HooksBody,
  models: ModelsBody,
  text: TextBody,
};

export const tool_icon = (step: ToolStep): IconComponent => (step.status === "denied" ? ShieldTerminalIcon : tool_icons[tool_meta(step).icon]);

type LiveBodyProps = { step: ToolStep; live: string | null; chat_id: string };

const LiveBody = ({ step, live, chat_id }: LiveBodyProps) =>
  is_shell_run(step.name) ? <LiveCommand step={step} output={live} chat_id={chat_id} /> : live && <OutputBlock text={live} />;

const ViewBody = ({ view, step }: { view: ToolView; step: ToolStep }) => {
  const Body = view_bodies[view.kind] as ComponentType<{ view: ToolView; step: ToolStep }> | undefined;
  return Body ? <Body view={view} step={step} /> : null;
};

export const ToolBody = ({ step, chat_id }: { step: ToolStep; chat_id: string }) => {
  const t = use_t();
  const live = step.progress?.output_tail ?? null;
  const draft = live_draft(step);
  const error = shown_error(t, step);
  const note = denial_note(t, step);
  const runs = step_hooks(step);
  return (
    <div className="tool-body">
      {hook_blocked(step) && <BlockedCall step={step} />}
      {is_reviewing(step) && <ReviewBody step={step} />}
      {error && <div className="tool-body-error">{error}</div>}
      {draft && <DraftCode draft={draft} />}
      {(live || live_command(step)) && <LiveBody step={step} live={live} chat_id={chat_id} />}
      {step.view && view_content(t, step, step.view) && <ViewBody view={step.view} step={step} />}
      {note && <ReviewNotice note={note} />}
      {!step.view && !live && !error && step.status !== "denied" && step.result_text && <OutputBlock text={step.result_text} />}
      {runs.length > 0 && <HookRuns runs={runs} />}
    </div>
  );
};
