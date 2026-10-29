import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { IconButton, PrimaryButton } from "../../components/Button.tsx";
import { class_names } from "../../components/class-names.ts";
import { ArrowUpIcon, ClipboardListIcon, CircleSpinnerIcon, CloseIcon, PlusIcon, StopIcon } from "../../components/icons.tsx";
import { layer_count } from "../../components/layers.ts";
import { use_t } from "../../i18n/index.ts";
import { draft_of, draft_sendable, has_chip, visualize_chip } from "../../state/chat-drafts.ts";
import { attach_files, composer_store, dismiss_error, queue_draft, set_composer_error, set_draft_text, stop_turn, submit, toggle_plan } from "../../state/composer.ts";
import { cancel_dictation, dictation_store, finish_dictation } from "../../state/dictation.ts";
import { insert_dictation } from "../../state/dictation-text.ts";
import { use_store } from "../../state/use-store.ts";
import { start_typed_review } from "./command-registry.ts";
import { use_chat_busy, use_model_choice, use_model_context, use_shown_context } from "./composer-hooks.ts";
import { ComposerMedia } from "./ComposerMedia.tsx";
import { DictationButton } from "./DictationButton.tsx";
import { DraftChips } from "./DraftChips.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { ModePicker } from "./ModePicker.tsx";
import { PlusMenu } from "./PlusMenu.tsx";
import { parse_review_command } from "./review-command.ts";
import { SlashMenu, slash_option_id } from "./SlashMenu.tsx";
import { use_command_context } from "./use-command-context.ts";
import { use_slash_menu } from "./use-slash-menu.ts";
import { WorktreeChip } from "./WorktreeChip.tsx";

const max_area_px = 240;

const has_files = (event: DragEvent<HTMLDivElement>) => [...event.dataTransfer.types].includes("Files");

type ComposerProps = { chat_id: string | null; project_path: string; draft_key: string; placement: "hero" | "docked" };

export const Composer = ({ chat_id, project_path, draft_key, placement }: ComposerProps) => {
  const t = use_t();
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const plus_button = useRef<HTMLButtonElement>(null);
  const pending_caret = useRef<number | null>(null);
  const shown_key = useRef(draft_key);
  const list_id = useId();
  const [dragging, set_dragging] = useState(false);
  const [plus_for, set_plus_for] = useState<string | null>(null);
  const [note, set_note] = useState<{ key: string; text: string } | null>(null);
  if (plus_for !== null && plus_for !== draft_key) {
    set_plus_for(null);
  }
  if (note !== null && note.key !== draft_key) {
    set_note(null);
  }
  const draft = use_store(composer_store, (state) => draft_of(state, draft_key));
  const sending = use_store(composer_store, (state) => Boolean(state.sending[draft_key]));
  const compacting = use_store(composer_store, (state) => Boolean(state.compacting[draft_key]));
  const error = use_store(composer_store, (state) => state.errors[draft_key] ?? "");
  const dictating = use_store(dictation_store, (state) => (state?.draft_key === draft_key ? state.phase : null));
  const { model, setting: context_setting } = use_model_context(chat_id);
  const choice = use_model_choice(chat_id);
  const pro = choice?.pro ?? false;
  const tier = choice?.tier ?? null;
  const busy = use_chat_busy(chat_id);

  const { usage: shown_usage } = use_shown_context(chat_id);
  const sendable = (draft_sendable(draft) || dictating === "recording") && model !== null && dictating !== "starting" && dictating !== "transcribing";
  const needs_vision = model !== null && !model.vision && draft.uploads.some((upload) => upload.image);
  const plus_open = plus_for === draft_key;
  const shown_note = note?.text ?? "";

  const report = (text: string, tone: "note" | "error") => {
    if (tone === "error") {
      set_composer_error(draft_key, text);
      return;
    }
    set_note({ key: draft_key, text });
  };
  const context = use_command_context({
    chat_id,
    project_path,
    draft_key,
    busy,
    compacting,
    plan: draft.plan,
    visualize: has_chip(draft, visualize_chip),
    usage: shown_usage,
    model,
    model_context: context_setting,
    pro,
    tier,
    report,
  });
  const slash = use_slash_menu(draft.text, context, (text, caret) => {
    pending_caret.current = caret;
    set_draft_text(draft_key, text);
  });
  const active_option = slash.open ? slash.items[slash.active] : undefined;

  useLayoutEffect(() => {
    const node = area.current;
    if (!node) {
      return;
    }
    if (pending_caret.current !== null) {
      node.setSelectionRange(pending_caret.current, pending_caret.current);
      pending_caret.current = null;
    }
    node.style.height = "auto";
    if (draft.text === "") {
      return;
    }
    node.style.height = `${Math.min(node.scrollHeight, max_area_px)}px`;
  }, [draft.text]);

  useEffect(() => {
    if (layer_count() > 0) {
      return;
    }
    area.current?.focus({ preventScroll: true });
  }, [chat_id]);

  useLayoutEffect(() => {
    shown_key.current = draft_key;
    return () => {
      if (dictation_store.get()?.draft_key === draft_key) {
        cancel_dictation();
      }
    };
  }, [draft_key]);

  useEffect(() => {
    if (dictating !== "starting" && dictating !== "recording") {
      return;
    }
    const on_escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel_dictation();
      }
    };
    window.addEventListener("keydown", on_escape);
    return () => window.removeEventListener("keydown", on_escape);
  }, [dictating]);

  const finish_dictating = async (then_send: boolean) => {
    const key = draft_key;
    const spoken = await finish_dictation();
    if (spoken === null) {
      return;
    }
    const showing = shown_key.current === key;
    const inserted = insert_dictation(draft_of(composer_store.get(), key).text, showing ? (area.current?.selectionStart ?? null) : null, spoken);
    if (showing) {
      pending_caret.current = inserted.caret;
    }
    set_draft_text(key, inserted.text);
    if (!showing) {
      return;
    }
    area.current?.focus({ preventScroll: true });
    if (then_send && model !== null) {
      void submit(chat_id, project_path);
    }
  };

  const send = () => {
    if (dictating === "recording") {
      void finish_dictating(true);
      return;
    }
    const review = parse_review_command(draft.text);
    if (review !== null && start_typed_review(context, review.pr)) {
      return;
    }
    if (sendable) {
      void submit(chat_id, project_path);
    }
  };

  const on_key_down = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.on_key_down(event)) {
      return;
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && busy && chat_id !== null && sendable) {
      event.preventDefault();
      void queue_draft(chat_id);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    send();
  };

  const on_paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0 || event.clipboardData.getData("text/plain") !== "") {
      return;
    }
    event.preventDefault();
    void attach_files(draft_key, files);
  };

  const on_drop = (event: DragEvent<HTMLDivElement>) => {
    if (!has_files(event)) {
      return;
    }
    event.preventDefault();
    set_dragging(false);
    void attach_files(draft_key, [...event.dataTransfer.files]);
  };

  const action = () => {
    if (sending && !busy) {
      return <PrimaryButton label={t("composer.sending")} icon={<CircleSpinnerIcon size={16} className="spin" />} disabled />;
    }
    if (busy && chat_id !== null && dictating === null && draft.text.trim() === "" && draft.uploads.length === 0 && draft.chips.length === 0) {
      return <PrimaryButton label={t("composer.stop")} icon={<StopIcon size={16} />} onClick={() => void stop_turn(chat_id)} />;
    }
    return <PrimaryButton label={t(busy || compacting ? "composer.queue_send" : "composer.send")} icon={<ArrowUpIcon size={16} />} disabled={!sendable} onClick={send} />;
  };

  return (
    <div
      className={class_names("composer", "raised-surface")}
      data-placement={placement}
      onDragOver={(event) => {
        if (has_files(event)) {
          event.preventDefault();
          set_dragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          set_dragging(false);
        }
      }}
      onDrop={on_drop}
    >
      <ComposerMedia draft_key={draft_key} uploads={draft.uploads} />
      <textarea
        ref={area}
        className="composer-input"
        rows={1}
        value={draft.text}
        placeholder={t("composer.placeholder")}
        aria-label={t("composer.placeholder")}
        role="combobox"
        aria-expanded={slash.open}
        aria-autocomplete="list"
        aria-controls={slash.open ? list_id : undefined}
        aria-activedescendant={active_option ? slash_option_id(list_id, active_option.id) : undefined}
        onChange={(event) => {
          set_draft_text(draft_key, event.target.value);
          slash.track(event.target);
          set_note(null);
        }}
        onSelect={(event) => slash.track(event.currentTarget)}
        onKeyDown={on_key_down}
        onPaste={on_paste}
      />
      {(error || needs_vision || shown_note) && (
        <div className="composer-feedback">
          {needs_vision && <span>{t("composer.vision_warning")}</span>}
          {shown_note && <span>{shown_note}</span>}
          {error && (
            <button type="button" className="composer-error" onClick={() => dismiss_error(draft_key)}>
              {error}
            </button>
          )}
        </div>
      )}
      <div className="composer-bar">
        <IconButton
          ref={plus_button}
          label={t("commands.plus")}
          className="composer-plus"
          active={plus_open}
          aria-expanded={plus_open}
          aria-haspopup="dialog"
          onClick={() => set_plus_for(plus_open ? null : draft_key)}
        >
          <PlusIcon size={16} />
        </IconButton>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            void attach_files(draft_key, files);
          }}
        />
        <ModelPicker chat_id={chat_id} />
        <ModePicker chat_id={chat_id} />
        {draft.plan && (
          <button
            type="button"
            className="composer-chip draft-chip"
            data-active
            data-kind="plan"
            aria-pressed
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => toggle_plan(draft_key)}
          >
            <span className="draft-chip-icon">
              <ClipboardListIcon size={15} />
              <CloseIcon size={15} />
            </span>
            <span className="composer-chip-label">{t("composer.plan")}</span>
          </button>
        )}
        {chat_id === null && <WorktreeChip draft_key={draft_key} project_path={project_path} />}
        <DraftChips draft_key={draft_key} chips={draft.chips} />
        <span className="composer-spacer" />
        <DictationButton draft_key={draft_key} on_stop={() => void finish_dictating(false)} />
        {action()}
      </div>
      {dragging && <div className="composer-drop">{t("composer.drop")}</div>}
      <PlusMenu
        open={plus_open}
        keep={(target) => plus_button.current?.contains(target) ?? false}
        chat_id={chat_id}
        project_path={project_path}
        draft_key={draft_key}
        draft={draft}
        on_close={() => set_plus_for(null)}
        on_files={() => picker.current?.click()}
      />
      <SlashMenu slash={slash} keep={(target) => area.current?.contains(target) ?? false} list_id={list_id} />
    </div>
  );
};
