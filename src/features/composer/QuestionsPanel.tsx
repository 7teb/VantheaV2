import { useLayoutEffect, useMemo, useRef } from "react";
import { open_questions, type OpenQuestion } from "../../../shared/questions.ts";
import { ChevronLeftIcon, ChevronRightIcon, CircleHelpIcon } from "../../components/icons.tsx";
import { QuestionForm } from "../../components/QuestionForm.tsx";
import { use_t } from "../../i18n/index.ts";
import type { ActionResult } from "../../state/chat-actions.ts";
import { chat_view_store } from "../../state/chat-view.ts";
import { current_index, empty_draft, shown_answer } from "../../state/question-drafts.ts";
import { dismiss_open, question_drafts_store, record_answer, record_text, show_question, submit_answers } from "../../state/questions.ts";
import { use_store } from "../../state/use-store.ts";
import "./QuestionsPanel.css";

type QuestionsCardProps = { chat_id: string; open: OpenQuestion[] };

const QuestionsCard = ({ chat_id, open }: QuestionsCardProps) => {
  const t = use_t();
  const card = useRef<HTMLDivElement>(null);
  const draft = use_store(question_drafts_store, (drafts) => drafts[chat_id] ?? empty_draft);
  const index = current_index(open, draft);
  const question = open[index];
  const last = index === open.length - 1;

  useLayoutEffect(() => {
    const node = card.current;
    const slot = node?.closest(".composer-slot");
    return () => {
      if (!node || !slot || !node.contains(document.activeElement)) {
        return;
      }
      queueMicrotask(() => {
        const idle = document.activeElement === null || document.activeElement === document.body;
        if (idle && slot.isConnected) {
          slot.querySelector<HTMLElement>("textarea.composer-input")?.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  const go = (step: -1 | 1) => {
    const target = open[index + step];
    if (target) {
      show_question(chat_id, target.id);
    }
  };

  const answer = async (text: string): Promise<ActionResult> => {
    if (!last) {
      record_answer(chat_id, open, question.id, text);
      return { ok: true };
    }
    const result = await submit_answers(chat_id, open, question.id, text);
    return result.ok ? result : { ok: false, error: t("questions.send_failed", { x: result.error }) };
  };

  const dismiss = async (): Promise<ActionResult> => {
    const result = await dismiss_open(chat_id, open);
    return result.ok ? result : { ok: false, error: t("questions.dismiss_failed", { x: result.error }) };
  };

  const previous_label = t("questions.previous");
  const next_label = t("questions.next_question");
  const head = (
    <>
      <CircleHelpIcon size={16} className="questions-head-icon" />
      <span>{t("questions.header")}</span>
      {open.length > 1 && (
        <span className="questions-nav">
          <button type="button" className="questions-nav-button" aria-label={previous_label} title={previous_label} disabled={index === 0} onClick={() => go(-1)}>
            <ChevronLeftIcon size={16} />
          </button>
          <span className="questions-count">{t("questions.count", { n: index + 1, total: open.length })}</span>
          <button type="button" className="questions-nav-button" aria-label={next_label} title={next_label} disabled={last} onClick={() => go(1)}>
            <ChevronRightIcon size={16} />
          </button>
        </span>
      )}
    </>
  );

  return (
    <div ref={card} className="composer-dock-card raised-surface enter-fade-up">
      <QuestionForm
        key={question.id}
        head={head}
        title={question.title}
        options={question.options}
        on_choose={(choice) => answer(question.options[choice])}
        on_other={answer}
        on_dismiss={dismiss}
        on_navigate={open.length > 1 ? go : undefined}
        on_edit={(text) => record_text(chat_id, question.id, text)}
        other_label={t(question.options.length > 0 ? "questions.other" : "questions.reply")}
        submit_label={t(last ? "questions.send" : "questions.next")}
        auto_focus={false}
        initial_answer={shown_answer(draft, question.id)}
      />
    </div>
  );
};

export const QuestionsPanel = ({ chat_id }: { chat_id: string }) => {
  const chat = use_store(chat_view_store, (state) => state.entries[chat_id]?.chat ?? null);
  const open = useMemo(() => (chat ? open_questions(chat.messages, chat.questions) : []), [chat]);
  if (open.length === 0) {
    return null;
  }
  return <QuestionsCard chat_id={chat_id} open={open} />;
};
