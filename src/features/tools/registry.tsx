import type { ComponentType } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import type { ToolView, ToolViewKind } from "../../../shared/tool-view.ts";
import {
  AtSignIcon,
  BotIcon,
  ClipboardListIcon,
  ClockIcon,
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
import { ImageBody, WebSearchBody } from "./bodies-web.tsx";
import { BrowserBody, McpBody, MemoryBody, PlanBody, SkillBody, TextBody, TodosBody } from "./bodies-work.tsx";
import type { BodyProps } from "./body-types.ts";
import { OutputBlock } from "./OutputBlock.tsx";
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
  text: TextBody,
};

export const tool_icon = (step: ToolStep): IconComponent => tool_icons[tool_meta(step).icon];

const ViewBody = ({ view, step }: { view: ToolView; step: ToolStep }) => {
  const Body = view_bodies[view.kind] as ComponentType<{ view: ToolView; step: ToolStep }>;
  return <Body view={view} step={step} />;
};

export const has_body = (step: ToolStep) =>
  step.view !== null || Boolean(step.error) || Boolean(step.progress?.output_tail) || (!is_active_status(step.status) && step.result_text.length > 0);

export const ToolBody = ({ step }: { step: ToolStep }) => {
  const t = use_t();
  const live = is_active_status(step.status) ? step.progress?.output_tail : null;
  return (
    <div className="tool-body">
      {step.error && <div className="tool-body-error">{step.error}</div>}
      {step.status === "cancelled" && <div className="tool-body-muted">{t("tools.cancelled")}</div>}
      {live && <OutputBlock text={live} />}
      {step.view && <ViewBody view={step.view} step={step} />}
      {!step.view && !live && !step.error && step.result_text && <OutputBlock text={step.result_text} />}
    </div>
  );
};
