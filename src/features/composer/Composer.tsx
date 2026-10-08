import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { IconButton, PrimaryButton } from "../../components/Button.tsx";
import { class_names } from "../../components/class-names.ts";
import { ArrowUpIcon, ClipboardListIcon, LoaderIcon, PaperclipIcon, StopIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { draft_of, draft_sendable } from "../../state/chat-drafts.ts";
import { attach_files, composer_store, dismiss_error, set_draft_text, stop_turn, submit, toggle_plan } from "../../state/composer.ts";
import { find_model, models_store } from "../../state/models.ts";
import { settings_store } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";
import { AttachmentChips } from "./AttachmentChips.tsx";
import { use_chat_busy, use_context_usage } from "./composer-hooks.ts";
import { ContextRing } from "./ContextRing.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { ModePicker } from "./ModePicker.tsx";

const max_area_px = 240;

const has_files = (event: DragEvent<HTMLDivElement>) => [...event.dataTransfer.types].includes("Files");

type ComposerProps = { chat_id: string | null; project_path: string; draft_key: string; placement: "hero" | "docked" };

export const Composer = ({ chat_id, project_path, draft_key, placement }: ComposerProps) => {
  const t = use_t();
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, set_dragging] = useState(false);
  const draft = use_store(composer_store, (state) => draft_of(state, draft_key));
  const sending = use_store(composer_store, (state) => Boolean(state.sending[draft_key]));
  const error = use_store(composer_store, (state) => state.errors[draft_key] ?? "");
  const catalog = use_store(models_store, (state) => state.catalog);
  const model_id = use_store(settings_store, (state) => state?.model ?? null);
  const busy = use_chat_busy(chat_id);
  const usage = use_context_usage(chat_id);

  useLayoutEffect(() => {
    const node = area.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    if (draft.text === "") {
      return;
    }
    node.style.height = `${Math.min(node.scrollHeight, max_area_px)}px`;
  }, [draft.text]);

  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, [chat_id]);

  const model = model_id ? find_model(catalog, model_id) : null;
  const sendable = draft_sendable(draft) && model !== null;
  const needs_vision = model !== null && !model.vision && draft.uploads.some((upload) => upload.image && upload.status !== "failed");

  const send = () => {
    if (sendable) {
      void submit(chat_id, project_path);
    }
  };

  const on_key_down = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.currentTarget.blur();
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
      return <PrimaryButton label={t("composer.sending")} icon={<LoaderIcon size={17} className="spin" />} disabled />;
    }
    if (busy && chat_id !== null && draft.text.trim() === "" && draft.uploads.length === 0) {
      return <PrimaryButton label={t("composer.stop")} icon={<StopIcon size={16} />} onClick={() => void stop_turn(chat_id)} />;
    }
    return <PrimaryButton label={t(busy ? "composer.queue" : "composer.send")} icon={<ArrowUpIcon size={17} />} disabled={!sendable} onClick={send} />;
  };

  return (
    <div
      className={class_names("composer", "inset-surface", dragging && "is-dragging")}
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
      <AttachmentChips draft_key={draft_key} uploads={draft.uploads} />
      <textarea
        ref={area}
        className="composer-input"
        rows={1}
        value={draft.text}
        placeholder={t("composer.placeholder")}
        aria-label={t("composer.placeholder")}
        spellCheck={false}
        onChange={(event) => set_draft_text(draft_key, event.target.value)}
        onKeyDown={on_key_down}
        onPaste={on_paste}
      />
      {(error || needs_vision) && (
        <div className="composer-feedback">
          {needs_vision && <span>{t("composer.vision_warning")}</span>}
          {error && (
            <button type="button" className="composer-error" onClick={() => dismiss_error(draft_key)}>
              {error}
            </button>
          )}
        </div>
      )}
      <div className="composer-bar">
        <IconButton label={t("composer.attach")} onClick={() => picker.current?.click()}>
          <PaperclipIcon size={17} />
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
        <ModelPicker />
        <ModePicker chat_id={chat_id} />
        <button type="button" className="composer-chip" aria-pressed={draft.plan} data-active={draft.plan} onClick={() => toggle_plan(draft_key)}>
          <ClipboardListIcon size={15} />
          <span className="composer-chip-label">{t("composer.plan")}</span>
        </button>
        <span className="composer-spacer" />
        {usage && chat_id && <ContextRing usage={usage} chat_id={chat_id} busy={busy} />}
        {action()}
      </div>
      {dragging && <div className="composer-drop">{t("composer.drop")}</div>}
    </div>
  );
};
