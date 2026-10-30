import { Fragment, memo, useRef } from "react";
import type { AssistantMessage as AssistantMessageData, Message, NoticeStep } from "../../../shared/chat.ts";
import { file_changes } from "../../../shared/file-changes.ts";
import { build_blocks } from "./assistant-blocks.ts";
import { summary_line_step } from "./compaction-line.ts";
import { FileChanges } from "./FileChanges.tsx";
import { OriginNote } from "./OriginNote.tsx";
import { turn_layout } from "./origin-steps.ts";
import { CompactionRow } from "./StepRows.tsx";
import { TurnBody } from "./TurnBody.tsx";
import { FoldItem, use_turn_folded } from "./TurnFold.tsx";
import { TurnHead, use_turn_head } from "./TurnHead.tsx";
import { member_facts, turn_shape, type MemberFacts } from "./turn-shape.ts";
import "./AssistantMessage.css";

const facts_cache = new WeakMap<AssistantMessageData, MemberFacts>();

const facts_of = (message: AssistantMessageData): MemberFacts => {
  const cached = facts_cache.get(message);
  if (cached) {
    return cached;
  }
  const facts = member_facts(message, build_blocks(message.steps));
  facts_cache.set(message, facts);
  return facts;
};

const lead_cache = new WeakMap<AssistantMessageData, { key: string; facts: MemberFacts }>();

const facts_with = (message: AssistantMessageData, lead: NoticeStep[] | undefined): MemberFacts => {
  if (!lead) {
    return facts_of(message);
  }
  const key = lead.map((step) => `${step.id}\n${step.text}`).join("\n\n");
  const cached = lead_cache.get(message);
  if (cached?.key === key) {
    return cached.facts;
  }
  const facts = member_facts(message, build_blocks([...lead, ...message.steps]));
  lead_cache.set(message, { key, facts });
  return facts;
};

type AssistantMessageProps = {
  chat_id: string;
  messages: Message[];
  last_id: string;
  busy: boolean;
  last_plan_id: string | null;
  accepted: ReadonlySet<string>;
  undoable_id: string | null;
  summary_after: string | null;
};

const same_turn = (before: AssistantMessageProps, after: AssistantMessageProps) =>
  before.chat_id === after.chat_id &&
  before.last_id === after.last_id &&
  before.busy === after.busy &&
  before.last_plan_id === after.last_plan_id &&
  before.undoable_id === after.undoable_id &&
  before.summary_after === after.summary_after &&
  before.messages.length === after.messages.length &&
  before.messages.every((message, index) => message === after.messages[index] && before.accepted.has(message.id) === after.accepted.has(message.id));

export const AssistantMessage = memo(({ chat_id, messages, last_id, busy, last_plan_id, accepted, undoable_id, summary_after }: AssistantMessageProps) => {
  const members = messages.filter((message): message is AssistantMessageData => message.role === "assistant");
  const layout = turn_layout(messages);
  const facts = members.map((member) => facts_with(member, layout.lead.get(member.id)));
  const shape = turn_shape(facts);
  const frame = useRef<HTMLDivElement>(null);
  const leader = members[0] as AssistantMessageData;
  const last = members.at(-1) as AssistantMessageData;
  const fold = use_turn_folded(chat_id, leader.id, shape, frame);
  const head = use_turn_head(shape.head, last.status === "streaming", fold.holding);
  const finished = last.status !== "streaming" && !fold.holding;
  const own_changes = members.slice(0, -1).every((member) => file_changes(member.steps).length === 0);
  const file_card = finished && (
    <FileChanges
      chat_id={chat_id}
      steps={members.flatMap((member) => member.steps)}
      from_id={leader.id}
      to_id={last.id}
      undo_id={own_changes && undoable_id === last.id ? last.id : null}
      busy={busy}
    />
  );
  return (
    <div ref={frame} className="assistant-message enter-fade-up" data-last={last.id === last_id}>
      {head && <TurnHead chat_id={chat_id} message_id={leader.id} created_at={leader.created_at} head={head} foldable={fold.foldable} folded={fold.folded} />}
      {messages.map((message) => {
        const summary = summary_after === message.id && <CompactionRow step={summary_line_step} />;
        if (message.role === "user") {
          return (
            <Fragment key={message.id}>
              {!layout.absorbed.has(message.id) && (
                <FoldItem folded={fold.folded}>
                  <OriginNote message={message} />
                </FoldItem>
              )}
              {summary}
            </Fragment>
          );
        }
        const index = members.indexOf(message);
        return (
          <Fragment key={message.id}>
            <TurnBody
              chat_id={chat_id}
              facts={facts[index] as MemberFacts}
              folds={shape.folds[index] as ReadonlySet<string>}
              folded={fold.folded}
              final={index === members.length - 1}
              is_last={message.id === last_id}
              busy={busy}
              last_plan={last_plan_id === message.id}
              plan_accepted={accepted.has(message.id)}
              file_card={index === members.length - 1 ? file_card : null}
            />
            {summary}
          </Fragment>
        );
      })}
    </div>
  );
}, same_turn);
