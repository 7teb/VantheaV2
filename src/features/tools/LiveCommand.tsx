import { useState } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { call_shell, shell_labels } from "../../../shared/shell.ts";
import { Button } from "../../components/Button.tsx";
import { LayersIcon } from "../../components/icons.tsx";
import { use_t, type MessageKey } from "../../i18n/index.ts";
import { move_command_to_background, type CommandMove } from "../../state/background.ts";
import { CommandCard } from "./CommandCard.tsx";
import { offers_background } from "./tool-body.ts";

const move_problems: Record<Exclude<CommandMove["status"], "moved">, MessageKey> = {
  finished: "tools.move_finished",
  full: "tools.move_full",
  failed: "tools.move_failed",
};

const MoveToBackground = ({ chat_id, call_id }: { chat_id: string; call_id: string }) => {
  const t = use_t();
  const [pending, set_pending] = useState(false);
  const [problem, set_problem] = useState<MessageKey | null>(null);
  const move = async () => {
    set_pending(true);
    set_problem(null);
    const result = await move_command_to_background(chat_id, call_id);
    if (result.status === "moved") {
      return;
    }
    set_problem(move_problems[result.status]);
    set_pending(result.status === "finished");
  };
  return (
    <>
      {problem && (
        <span className="command-card-problem" title={t(problem)}>
          {t(problem)}
        </span>
      )}
      <Button variant="ghost" className="command-card-action" icon={<LayersIcon size={14} />} disabled={pending} onClick={() => void move()}>
        {t("tools.move_to_background")}
      </Button>
    </>
  );
};

type LiveCommandProps = { step: ToolStep; output: string | null; chat_id: string };

export const LiveCommand = ({ step, output, chat_id }: LiveCommandProps) => {
  const t = use_t();
  return (
    <CommandCard
      shell={shell_labels[call_shell(step.name, step.args)]}
      command={String(step.args.command ?? "")}
      output={output || null}
      footer={
        <>
          {offers_background(step) && <MoveToBackground chat_id={chat_id} call_id={step.call_id} />}
          <span className="is-working">{t("tools.command_running")}</span>
        </>
      }
    />
  );
};
