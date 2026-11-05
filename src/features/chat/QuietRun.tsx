import { memo, useMemo } from "react";
import { use_language, use_t } from "../../i18n/index.ts";
import { clock_label } from "../scheduled/scheduled-time.ts";
import { WorkGroup } from "../tools/WorkGroup.tsx";
import { build_blocks, type Block } from "./assistant-blocks.ts";
import type { QuietRunPair } from "./quiet-runs.ts";
import { RunDivider, use_lazy_open } from "./RunDivider.tsx";
import "./ScheduledRun.css";

type WorkBlock = Extract<Block, { kind: "work" }>;

const QuietLine = ({ chat_id, run }: { chat_id: string; run: QuietRunPair }) => {
  const t = use_t();
  const language = use_language();
  const fold = use_lazy_open();
  const work = useMemo(() => build_blocks(run.answer.steps).filter((block): block is WorkBlock => block.kind === "work"), [run.answer.steps]);
  return (
    <RunDivider
      className="quiet-run"
      label={t("scheduled.quiet_line", { time: clock_label(run.prompt.created_at, Date.now(), language) })}
      open={fold.open}
      expandable={work.length > 0}
      on_toggle={fold.toggle}
      on_closed={fold.closed}
    >
      {fold.mounted && (
        <div className="quiet-run-work">
          {work.map((block) => (
            <WorkGroup key={block.id} chat_id={chat_id} steps={block.steps} streaming={false} tail={false} pending={false} />
          ))}
        </div>
      )}
    </RunDivider>
  );
};

const QuietGroup = ({ chat_id, runs }: { chat_id: string; runs: QuietRunPair[] }) => {
  const t = use_t();
  const language = use_language();
  const fold = use_lazy_open();
  const first = runs[0] as QuietRunPair;
  return (
    <RunDivider
      className="quiet-run"
      group
      label={t("scheduled.quiet_group", { n: runs.length, time: clock_label(first.prompt.created_at, Date.now(), language) })}
      open={fold.open}
      expandable
      on_toggle={fold.toggle}
      on_closed={fold.closed}
    >
      {fold.mounted && (
        <div className="quiet-run-list">
          {runs.map((run) => (
            <QuietLine key={run.prompt.id} chat_id={chat_id} run={run} />
          ))}
        </div>
      )}
    </RunDivider>
  );
};

const same_runs = (before: QuietRunProps, after: QuietRunProps) =>
  before.chat_id === after.chat_id && before.runs.length === after.runs.length && before.runs.every((run, index) => run.answer === after.runs[index]?.answer && run.prompt === after.runs[index]?.prompt);

type QuietRunProps = { chat_id: string; runs: QuietRunPair[] };

export const QuietRun = memo(({ chat_id, runs }: QuietRunProps) => (runs.length === 1 ? <QuietLine chat_id={chat_id} run={runs[0] as QuietRunPair} /> : <QuietGroup chat_id={chat_id} runs={runs} />), same_runs);
