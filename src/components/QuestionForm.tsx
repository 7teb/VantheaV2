import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { use_t } from "../i18n/index.ts";
import type { ActionResult } from "../state/chat-actions.ts";
import { ArrowLeftIcon, CloseIcon, PencilIcon } from "./icons.tsx";
import { question_key_action, type QuestionKeySource } from "./question-keys.ts";
import "./QuestionForm.css";

const advance_ms = 180;

type QuestionFormProps = {
  head?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  preview?: ReactNode;
  options: string[];
  on_choose: (index: number) => Promise<ActionResult>;
  on_other: (feedback: string) => Promise<ActionResult>;
  on_dismiss?: () => Promise<ActionResult>;
  on_navigate?: (step: -1 | 1) => void;
  on_edit?: (text: string) => void;
  other_label?: string;
  submit_label?: string;
  auto_focus?: boolean;
  initial_answer?: string;
  skip_at?: number;
};

type PendingChoice = { timer: number; send: () => void };

const initial_selection = (options: string[], answer: string | undefined): number => {
  if (answer) {
    return options.indexOf(answer);
  }
  return options.length > 0 ? 0 : -1;
};

export const QuestionForm = ({
  head,
  title,
  subtitle,
  preview,
  options,
  on_choose,
  on_other,
  on_dismiss,
  on_navigate,
  on_edit,
  other_label,
  submit_label,
  auto_focus = true,
  initial_answer,
  skip_at,
}: QuestionFormProps) => {
  const t = use_t();
  const title_id = useId();
  const card = useRef<HTMLDivElement>(null);
  const option_refs = useRef<(HTMLButtonElement | null)[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const pending = useRef<PendingChoice | null>(null);
  const [selected, set_selected] = useState(() => initial_selection(options, initial_answer));
  const [hovered, set_hovered] = useState<number | "other" | null>(null);
  const [advancing, set_advancing] = useState<number | null>(null);
  const [feedback, set_feedback] = useState(() => (initial_answer && !options.includes(initial_answer) ? initial_answer : ""));
  const [error, set_error] = useState("");
  const has_text = feedback.trim() !== "";
  const skip_ms = useMemo(() => (skip_at === undefined ? null : Math.max(0, skip_at - Date.now())), [skip_at]);
  const counting = skip_ms !== null && !has_text;
  const tab_stop = Math.max(selected, 0);

  useEffect(() => {
    if (auto_focus && (document.activeElement === null || document.activeElement === document.body)) {
      option_refs.current[0]?.focus({ preventScroll: true });
    }
    return () => {
      const choice = pending.current;
      if (choice) {
        window.clearTimeout(choice.timer);
        choice.send();
      }
    };
  }, []);

  useLayoutEffect(() => {
    const node = card.current;
    return () => {
      const container = node?.parentElement;
      if (!node || !container || !node.contains(document.activeElement)) {
        return;
      }
      queueMicrotask(() => {
        const idle = document.activeElement === null || document.activeElement === document.body;
        if (!node.isConnected && idle && container.isConnected) {
          container.querySelector<HTMLElement>(".question-option[tabindex='0'], .question-other-input")?.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  useLayoutEffect(() => {
    const node = input.current;
    if (!node) {
      return;
    }
    node.style.height = "";
    if (feedback) {
      node.style.height = `${node.scrollHeight}px`;
    }
  }, [feedback]);

  const settle = async (answer: Promise<ActionResult>) => {
    const result = await answer;
    if (result.ok) {
      return;
    }
    done.current = false;
    set_advancing(null);
    set_error(result.error);
  };

  const commit = (index: number) => {
    if (done.current) {
      return;
    }
    done.current = true;
    set_selected(index);
    set_advancing(index);
    set_error("");
    const send = () => {
      pending.current = null;
      void settle(on_choose(index));
    };
    pending.current = { timer: window.setTimeout(send, advance_ms), send };
  };

  const decide = (answer: () => Promise<ActionResult>) => {
    if (done.current) {
      return;
    }
    done.current = true;
    set_error("");
    void settle(answer());
  };

  const answer_other = (text: string) => decide(() => on_other(text));

  const dismiss = () => decide(on_dismiss ?? (() => on_other("")));

  const focus_other = () => {
    set_selected(-1);
    set_hovered(null);
    input.current?.focus();
  };

  const key_source = (target: EventTarget): QuestionKeySource => {
    if (target === input.current) {
      return "input";
    }
    return target instanceof HTMLButtonElement && target.getAttribute("role") !== "radio" ? "button" : "other";
  };

  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    if (done.current) {
      return;
    }
    const source = key_source(event.target);
    const action = question_key_action({
      key: event.key,
      shift: event.shiftKey,
      modified: event.ctrlKey || event.altKey || event.metaKey,
      composing: event.nativeEvent.isComposing,
      repeat: event.repeat,
      source,
      multiline: feedback.includes("\n"),
      navigable: on_navigate !== undefined,
      selected,
      count: options.length,
    });
    if (action === null) {
      return;
    }
    event.preventDefault();
    switch (action.kind) {
      case "choose":
        commit(action.index);
        return;
      case "select":
        set_selected(action.index);
        set_hovered(null);
        option_refs.current[action.index]?.focus();
        return;
      case "focus_other":
        focus_other();
        return;
      case "submit_other":
        answer_other(feedback.trim());
        return;
      case "dismiss":
        dismiss();
        return;
      case "navigate":
        on_navigate?.(action.step);
        return;
      case "consume":
        return;
    }
  };

  const on_card_mouse_down = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button, textarea, .question-other, .question-preview")) {
      return;
    }
    card.current?.focus({ preventScroll: true });
  };

  const on_other_mouse_down = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button, textarea")) {
      return;
    }
    event.preventDefault();
    focus_other();
  };

  const highlighted = (index: number) => {
    if (advancing !== null) {
      return advancing === index;
    }
    return hovered === null ? selected === index : hovered === index;
  };

  const dismiss_label = t("approval.dismiss");
  const other_placeholder = other_label ?? t("approval.no");

  return (
    <div
      ref={card}
      className="question-card enter-fade-up"
      role="group"
      aria-labelledby={title_id}
      tabIndex={-1}
      onKeyDown={on_key_down}
      onMouseDown={on_card_mouse_down}
    >
      <div className="question-head" role="alert" aria-atomic="true">
        <div className="question-head-text">
          {head ? <div className="question-head-content">{head}</div> : null}
          <div id={title_id} className="question-title">
            {title}
          </div>
          {subtitle ? <div className="question-subtitle">{subtitle}</div> : null}
        </div>
        <div className="question-head-side">
          <button type="button" className="question-icon-button" aria-label={dismiss_label} title={dismiss_label} onClick={dismiss}>
            <CloseIcon size={18} />
          </button>
        </div>
      </div>
      {preview ? <div className="question-preview">{preview}</div> : null}
      <div className="question-body">
        <div className="question-list">
          <div className="question-options" role="radiogroup" aria-label={title}>
            {options.map((label, index) => (
              <button
                key={index}
                ref={(node) => {
                  option_refs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={selected === index}
                tabIndex={index === tab_stop ? 0 : -1}
                className="question-option"
                data-highlight={highlighted(index)}
                onPointerEnter={() => set_hovered(index)}
                onPointerLeave={() => set_hovered(null)}
                onFocus={() => set_selected(index)}
                onClick={() => commit(index)}
              >
                <span className="question-index" data-solid={advancing === index}>
                  {index + 1}
                </span>
                <span className="question-option-label">{label}</span>
                <ArrowLeftIcon size={16} className="question-option-arrow" />
              </button>
            ))}
          </div>
          <div className="question-other" onPointerEnter={() => set_hovered("other")} onPointerLeave={() => set_hovered(null)} onMouseDown={on_other_mouse_down}>
            <span className="question-other-icon">
              <PencilIcon size={16} />
            </span>
            <textarea
              ref={input}
              className="question-other-input"
              rows={1}
              value={feedback}
              placeholder={other_placeholder}
              aria-label={other_placeholder}
              onFocus={() => set_selected(-1)}
              onChange={(event) => {
                set_feedback(event.target.value);
                on_edit?.(event.target.value);
              }}
            />
            <div className="question-actions">
              <button
                type="button"
                className="question-button"
                data-variant={has_text ? "primary" : "outline"}
                data-countdown={counting || undefined}
                style={counting ? ({ "--skip-ms": `${skip_ms}ms` } as CSSProperties) : undefined}
                onClick={() => answer_other(feedback.trim())}
              >
                <span>{has_text ? (submit_label ?? t("approval.submit")) : t("approval.skip")}</span>
              </button>
            </div>
          </div>
        </div>
        {error ? (
          <div className="question-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
};
