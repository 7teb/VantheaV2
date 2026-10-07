import { useState } from "react";
import type { Personality } from "../../../../shared/settings.ts";
import { Button } from "../../../components/Button.tsx";
import { ConfirmDialog } from "../../../components/Dialog.tsx";
import { CheckIcon } from "../../../components/icons.tsx";
import { Select } from "../../../components/Select.tsx";
import { TextArea } from "../../../components/TextField.tsx";
import { Toggle } from "../../../components/Toggle.tsx";
import { use_t, type MessageKey } from "../../../i18n/index.ts";
import { reset_memory } from "../../../state/extensions.ts";
import { settings_store, update_settings } from "../../../state/settings.ts";
import { use_store } from "../../../state/use-store.ts";
import { SettingsGroup, SettingsRow } from "../SettingsLayout.tsx";
import { ipc_error_text } from "./ipc-error.ts";
import { MemoryLists } from "./MemoryLists.tsx";
import { PaneSkeleton } from "./PaneSkeleton.tsx";
import "./panes.css";

const max_instructions = 8000;

const personalities: { id: Personality; label: MessageKey; description: MessageKey }[] = [
  { id: "pragmatic", label: "personalization.pragmatic", description: "personalization.pragmatic_desc" },
  { id: "friendly", label: "personalization.friendly", description: "personalization.friendly_desc" },
  { id: "cynical", label: "personalization.cynical", description: "personalization.cynical_desc" },
];

const InstructionsRow = ({ saved }: { saved: string }) => {
  const t = use_t();
  const [base, set_base] = useState(saved);
  const [draft, set_draft] = useState(saved);
  const [state, set_state] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  if (saved !== base) {
    set_base(saved);
    if (draft === base) {
      set_draft(saved);
    }
  }

  const save = async () => {
    set_state("saving");
    await update_settings({ custom_instructions: draft });
    set_state(settings_store.get()?.custom_instructions === draft ? "saved" : "failed");
  };

  return (
    <SettingsRow
      label={t("personalization.instructions")}
      hint={t("personalization.instructions_sub")}
      error={state === "failed" ? t("personalization.save_failed") : null}
      stacked
    >
      <div className="instructions-editor">
        <TextArea
          className="instructions-input"
          value={draft}
          maxLength={max_instructions}
          rows={6}
          placeholder={t("personalization.instructions_placeholder")}
          aria-label={t("personalization.instructions")}
          on_change={(value) => {
            set_draft(value);
            set_state("idle");
          }}
        />
        <div className="instructions-footer">
          <span className="instructions-count">{t("personalization.chars", { n: draft.length, max: max_instructions })}</span>
          <Button
            disabled={draft === saved || state === "saving"}
            icon={state === "saved" && draft === saved ? <CheckIcon size={15} /> : undefined}
            onClick={() => void save()}
          >
            {state === "saved" && draft === saved ? t("personalization.saved") : t("personalization.save")}
          </Button>
        </div>
      </div>
    </SettingsRow>
  );
};

const ResetRow = () => {
  const t = use_t();
  const [confirming, set_confirming] = useState(false);
  const [state, set_state] = useState<"idle" | "done">("idle");
  const [error, set_error] = useState<string | null>(null);

  const reset = async () => {
    set_error(null);
    try {
      await reset_memory();
      set_state("done");
    } catch (failure) {
      console.error("[settings] memory:reset failed", failure);
      set_error(ipc_error_text(failure));
    }
  };

  return (
    <SettingsRow label={t("personalization.mem_reset")} hint={t("personalization.mem_reset_sub")} error={error}>
      <Button variant="danger" onClick={() => set_confirming(true)}>
        {state === "done" ? t("personalization.mem_reset_done") : t("personalization.mem_reset_btn")}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t("personalization.mem_reset_title")}
        detail={t("personalization.mem_reset_sub")}
        confirm_label={t("personalization.mem_reset_btn")}
        cancel_label={t("common.cancel")}
        danger
        on_confirm={() => void reset()}
        on_close={() => set_confirming(false)}
      />
    </SettingsRow>
  );
};

export const PersonalizationPane = () => {
  const t = use_t();
  const personality = use_store(settings_store, (view) => view?.personality ?? null);
  const instructions = use_store(settings_store, (view) => view?.custom_instructions ?? "");
  const memory = use_store(settings_store, (view) => view?.memory ?? null);

  if (personality === null || memory === null) {
    return <PaneSkeleton rows={[110, 150, 130]} />;
  }

  const current = personalities.find((entry) => entry.id === personality) ?? personalities[0];

  return (
    <>
      <SettingsGroup>
        <SettingsRow label={t("personalization.personality")} hint={t(current.description)}>
          <Select
            options={personalities.map((entry) => ({ id: entry.id, label: t(entry.label) }))}
            value={personality}
            label={t("personalization.personality")}
            on_change={(next) => void update_settings({ personality: next })}
          />
        </SettingsRow>
        <InstructionsRow saved={instructions} />
      </SettingsGroup>
      <SettingsGroup label={t("personalization.memory")}>
        <SettingsRow label={t("personalization.mem_enable")} hint={t("personalization.mem_enable_sub")}>
          <Toggle checked={memory.enabled} label={t("personalization.mem_enable")} on_change={(enabled) => void update_settings({ memory: { enabled } })} />
        </SettingsRow>
        <SettingsRow label={t("personalization.mem_exclude")} hint={t("personalization.mem_exclude_sub")}>
          <Toggle
            checked={memory.exclude_tool_chats}
            disabled={!memory.enabled}
            label={t("personalization.mem_exclude")}
            on_change={(exclude_tool_chats) => void update_settings({ memory: { exclude_tool_chats } })}
          />
        </SettingsRow>
        <ResetRow />
      </SettingsGroup>
      <MemoryLists />
    </>
  );
};
