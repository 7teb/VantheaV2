import type { ComponentType } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { shell_name, type ToolView, type ToolViewKind } from "../../../shared/tool-view.ts";
import {
  AtSignIcon,
  BotIcon,
  CircleHelpIcon,
  ClipboardListIcon,
  ClockIcon,
  CoinsIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeCheckIcon,
  GlobeIcon,
  ImageIcon,
  LayersIcon,
  ListChecksIcon,
  MessageSquareIcon,
  OutlineIcon,
  ScrollTextIcon,
  SearchIcon,
  SquareTerminalIcon,
  SummaryIcon,
  WormIcon,
  type IconComponent,
} from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { AgentBody, BackgroundBody, CommandBody } from "./bodies-run.tsx";
import { EditBody, FilesBody, GrepBody, OutlineBody, ReadBody } from "./bodies-files.tsx";
import { ModelsBody } from "./bodies-models.tsx";
import { ImageBody, WebSearchBody } from "./bodies-web.tsx";
import { BrowserBody, McpBody, MemoryBody, PlanBody, QuestionsBody, SkillBody, TextBody, TodosBody } from "./bodies-work.tsx";
import type { BodyProps } from "./body-types.ts";
import { CommandCard } from "./CommandCard.tsx";
import { DraftCode } from "./DraftCode.tsx";
import { live_draft } from "./live-draft.ts";
import { OutputBlock } from "./OutputBlock.tsx";
import { is_reviewing } from "./review-phase.ts";
import { ReviewBody } from "./ReviewPending.tsx";
import { is_active_status, tool_meta, type ToolIconName } from "./tool-meta.ts";

export const tool_icons: Record<ToolIconName, IconComponent> = {
  terminal: SquareTerminalIcon,
  background: LayersIcon,
  file: FileTextIcon,
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
  mcp: AtSignIcon,
  clock: ClockIcon,
  models: CoinsIcon,
  question: CircleHelpIcon,
  text: MessageSquareIcon,
};

type Bodies = { [K in ToolViewKind]: ComponentType<BodyProps<K>> };

export const view_bodies: Bodies = {
  files: FilesBody,
  read: ReadBody,
  grep: GrepBody,
  outline: OutlineBody,
  edit: EditBody,
  command: CommandBody,
  background: BackgroundBody,
  agent: AgentBody,
  todos: TodosBody,
  plan: PlanBody,
  web_search: WebSearchBody,
  image: ImageBody,
  browser: BrowserBody,
  mcp: McpBody,
  memory: MemoryBody,
  skill: SkillBody,
  models: ModelsBody,
  questions: QuestionsBody,
  text: TextBody,
};

export const tool_icon = (step: ToolStep): IconComponent => tool_icons[tool_meta(step).icon];

const LiveBody = ({ step, live }: { step: ToolStep; live: string }) =>
  step.name === "run_command" ? <CommandCard shell={shell_name} command={String(step.args.command ?? "")} output={live} footer={null} /> : <OutputBlock text={live} />;

const ViewBody = ({ view, step }: { view: ToolView; step: ToolStep }) => {
  const Body = view_bodies[view.kind] as ComponentType<{ view: ToolView; step: ToolStep }>;
  return <Body view={view} step={step} />;
};

const output_views = new Set<ToolViewKind>(["command", "mcp", "text"]);

export const has_body = (step: ToolStep) =>
  is_reviewing(step) ||
  step.view !== null ||
  Boolean(step.error) ||
  Boolean(step.progress?.output_tail) ||
  (!is_active_status(step.status) && step.result_text.length > 0) ||
  live_draft(step) !== null;

export const ToolBody = ({ step, open }: { step: ToolStep; open: boolean }) => {
  const t = use_t();
  const live = is_active_status(step.status) ? step.progress?.output_tail : null;
  const draft = live_draft(step);
  const error = step.view && output_views.has(step.view.kind) ? null : step.error;
  return (
    <div className="tool-body">
      {is_reviewing(step) && <ReviewBody step={step} row_open={open} />}
      {error && <div className="tool-body-error">{error}</div>}
      {step.status === "cancelled" && <div className="tool-body-muted">{t("tools.cancelled")}</div>}
      {draft && <DraftCode draft={draft} />}
      {live && <LiveBody step={step} live={live} />}
      {step.view && <ViewBody view={step.view} step={step} />}
      {!step.view && !live && !step.error && step.result_text && <OutputBlock text={step.result_text} />}
    </div>
  );
};
