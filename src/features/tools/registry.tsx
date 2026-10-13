import type { ComponentType } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { shell_name, type ToolView, type ToolViewKind } from "../../../shared/tool-view.ts";
import {
  AppWindowIcon,
  AtSignIcon,
  BookOpenIcon,
  BotIcon,
  CameraIcon,
  CircleHelpIcon,
  ClipboardListIcon,
  ClockIcon,
  CoinsIcon,
  CompassIcon,
  FilePenIcon,
  GlobeCheckIcon,
  GlobeIcon,
  HourglassIcon,
  ImageIcon,
  KeyboardIcon,
  LayersIcon,
  ListChecksIcon,
  MessageSquareIcon,
  MonitorCheckIcon,
  MouseIcon,
  MousePointerClickIcon,
  OutlineIcon,
  ScanEyeIcon,
  ScanTextIcon,
  ScrollTextIcon,
  SearchIcon,
  ShieldTerminalIcon,
  SquareTerminalIcon,
  SummaryIcon,
  TextCursorInputIcon,
  WormIcon,
  type IconComponent,
} from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { AgentBody, BackgroundBody, CommandBody } from "./bodies-run.tsx";
import { EditBody, FilesBody, GrepBody, OutlineBody } from "./bodies-files.tsx";
import { ModelsBody } from "./bodies-models.tsx";
import { ImageBody, WebSearchBody } from "./bodies-web.tsx";
import { McpBody, MemoryBody, PeerMessageBody, PlanBody, QuestionsBody, TextBody, TodosBody } from "./bodies-work.tsx";
import type { BodyProps } from "./body-types.ts";
import { CommandCard } from "./CommandCard.tsx";
import { DraftCode } from "./DraftCode.tsx";
import { live_draft } from "./live-draft.ts";
import { OutputBlock } from "./OutputBlock.tsx";
import { is_reviewing } from "./review-phase.ts";
import { ReviewNotice } from "./ReviewNote.tsx";
import { ReviewBody } from "./ReviewPending.tsx";
import { denial_note, shown_error, view_content } from "./tool-body.ts";
import { tool_meta, type ToolIconName } from "./tool-meta.ts";

export const tool_icons: Record<ToolIconName, IconComponent> = {
  terminal: SquareTerminalIcon,
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
  agent: BotIcon,
  memory: WormIcon,
  skill: ScrollTextIcon,
  browser: GlobeIcon,
  browser_tabs: AppWindowIcon,
  browser_navigate: CompassIcon,
  browser_snapshot: ScanTextIcon,
  browser_click: MousePointerClickIcon,
  browser_type: TextCursorInputIcon,
  browser_key: KeyboardIcon,
  browser_scroll: MouseIcon,
  browser_wait: HourglassIcon,
  browser_screenshot: CameraIcon,
  browser_look: ScanEyeIcon,
  page_check: MonitorCheckIcon,
  mcp: AtSignIcon,
  clock: ClockIcon,
  models: CoinsIcon,
  question: CircleHelpIcon,
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
  todos: TodosBody,
  plan: PlanBody,
  web_search: WebSearchBody,
  image: ImageBody,
  mcp: McpBody,
  memory: MemoryBody,
  models: ModelsBody,
  questions: QuestionsBody,
  text: TextBody,
};

export const tool_icon = (step: ToolStep): IconComponent => (step.status === "denied" ? ShieldTerminalIcon : tool_icons[tool_meta(step).icon]);

const LiveBody = ({ step, live }: { step: ToolStep; live: string }) =>
  step.name === "run_command" ? <CommandCard shell={shell_name} command={String(step.args.command ?? "")} output={live} footer={null} /> : <OutputBlock text={live} />;

const ViewBody = ({ view, step }: { view: ToolView; step: ToolStep }) => {
  const Body = view_bodies[view.kind] as ComponentType<{ view: ToolView; step: ToolStep }> | undefined;
  return Body ? <Body view={view} step={step} /> : null;
};

export const ToolBody = ({ step, open }: { step: ToolStep; open: boolean }) => {
  const t = use_t();
  const live = step.progress?.output_tail ?? null;
  const draft = live_draft(step);
  const error = shown_error(step);
  const note = denial_note(t, step);
  return (
    <div className="tool-body">
      {is_reviewing(step) && <ReviewBody step={step} row_open={open} />}
      {error && <div className="tool-body-error">{error}</div>}
      {step.status === "cancelled" && <div className="tool-body-muted">{t("tools.cancelled")}</div>}
      {draft && <DraftCode draft={draft} />}
      {live && <LiveBody step={step} live={live} />}
      {step.view && view_content(t, step, step.view) && <ViewBody view={step.view} step={step} />}
      {note && note.lines.length > 0 && <ReviewNotice note={note} />}
      {!step.view && !live && !step.error && step.status !== "denied" && step.result_text && <OutputBlock text={step.result_text} />}
    </div>
  );
};
