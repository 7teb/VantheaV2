import type { ToolStep } from "../../../shared/chat.ts";
import { call_shell, shell_labels } from "../../../shared/shell.ts";
import { use_clock } from "../../components/use-clock.ts";
import { use_t } from "../../i18n/index.ts";
import { CommandCard } from "./CommandCard.tsx";
import { is_command_step, reviewing_label } from "./review-phase.ts";
import "./ReviewPending.css";

export const ReviewingLabel = ({ step }: { step: ToolStep }) => {
  const t = use_t();
  const now = use_clock(true);
  return reviewing_label(t, step, now);
};

export const ReviewBody = ({ step }: { step: ToolStep }) =>
  is_command_step(step) ? <CommandCard shell={shell_labels[call_shell(step.name, step.args)]} command={String(step.args.command ?? "")} output={null} footer={null} /> : null;
