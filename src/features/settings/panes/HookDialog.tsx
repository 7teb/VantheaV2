import { useState, type FormEvent } from "react";
import { hook_events, matcher_targets, type ScopedHook } from "../../../../shared/hooks.ts";
import { shell_kinds, shell_labels, type ShellKind } from "../../../../shared/shell.ts";
import { Button } from "../../../components/Button.tsx";
import { CollapsibleBody } from "../../../components/Collapsible.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Segmented } from "../../../components/Segmented.tsx";
import { Select } from "../../../components/Select.tsx";
import { TextArea, TextField } from "../../../components/TextField.tsx";
import { Toggle } from "../../../components/Toggle.tsx";
import { use_t } from "../../../i18n/index.ts";
import { save_hook } from "../../../state/hooks.ts";
import { settings_store } from "../../../state/settings.ts";
import { use_store } from "../../../state/use-store.ts";
import { project_path_label } from "../../sidebar/sidebar-model.ts";
import { event_label, matcher_all, matcher_label } from "../../tools/hook-text.ts";
import { draft_fields, draft_problems, draft_scope, empty_draft, global_scope, hook_draft, type HookDraft } from "./hook-form.ts";
import { ipc_error_text } from "./ipc-error.ts";
import "./hooks.css";

type HookDialogProps = { open: boolean; hook: ScopedHook | null; on_close: () => void };

export const HookDialog = ({ open, hook, on_close }: HookDialogProps) => {
  const t = use_t();
  const projects = use_store(settings_store, (state) => state?.projects ?? []);
  const [draft, set_draft] = useState<HookDraft>(empty_draft);
  const [opened, set_opened] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [busy, set_busy] = useState(false);
  if (open !== opened) {
    set_opened(open);
    if (open) {
      set_draft(hook ? hook_draft(hook, projects) : empty_draft);
      set_error(null);
    }
  }

  const problems = draft_problems(t, draft);
  const title = hook ? t("hooks.edit_title") : t("hooks.add_title");
  const field = <K extends keyof HookDraft>(key: K) => (value: HookDraft[K]) => set_draft((current) => ({ ...current, [key]: value }));
  const has_matcher = matcher_targets[draft.event] !== null;
  const scope_options = [
    { id: global_scope, label: t("hooks.scope_global") },
    ...projects.map((project) => ({ id: project.path, label: project.name })),
    ...(draft.scope !== global_scope && !projects.some((project) => project.path === draft.scope) ? [{ id: draft.scope, label: project_path_label(projects, draft.scope) }] : []),
  ];

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!problems.ready || busy) {
      return;
    }
    set_busy(true);
    set_error(null);
    try {
      await save_hook(draft_scope(draft), draft_fields(draft), hook?.id ?? null);
      on_close();
    } catch (failure) {
      console.error(`[settings] hooks:save failed for hook ${hook?.id ?? "(new)"}`, failure);
      set_error(t("hooks.save_failed", { x: ipc_error_text(failure) }));
    } finally {
      set_busy(false);
    }
  };

  return (
    <Dialog open={open} on_close={on_close} label={title} className="hook-dialog">
      <form className="hook-form" onSubmit={save}>
        <h2 className="hook-dialog-title">{title}</h2>
        <div className="dialog-field">
          <span className="dialog-field-label">{t("hooks.event_label")}</span>
          <Select
            className="hook-form-select"
            label={t("hooks.event_label")}
            value={draft.event}
            placement="bottom-start"
            options={hook_events.map((entry) => ({ id: entry, label: event_label(t, entry), hint: entry }))}
            on_change={field("event")}
          />
        </div>
        <CollapsibleBody open={has_matcher} className="hook-form-matcher">
          <div className="dialog-field">
            <span className="dialog-field-label">{matcher_label(t, draft.event) ?? t("hooks.matcher_label_tool")}</span>
            <TextField className="hook-form-code" value={draft.matcher} on_change={field("matcher")} placeholder={matcher_all(t, draft.event)} aria-label={matcher_label(t, draft.event) ?? ""} />
          </div>
          {problems.matcher && <p className="hook-note is-danger">{problems.matcher}</p>}
        </CollapsibleBody>
        <div className="dialog-field">
          <span className="dialog-field-label">{t("hooks.shell_label")}</span>
          <Segmented<ShellKind>
            className="pane-segmented"
            label={t("hooks.shell_label")}
            value={draft.shell}
            options={shell_kinds.map((kind) => ({ id: kind, label: shell_labels[kind] }))}
            on_change={field("shell")}
          />
        </div>
        <label className="dialog-field">
          <span className="dialog-field-label">{t("hooks.command_label")}</span>
          <TextArea
            className="hook-form-command"
            value={draft.command}
            rows={4}
            auto_grow
            max_height={240}
            placeholder={t(draft.shell === "bash" ? "hooks.command_example_bash" : "hooks.command_example_powershell")}
            on_change={field("command")}
          />
        </label>
        <div className="dialog-field">
          <span className="dialog-field-label">{t("hooks.timeout_label")}</span>
          <TextField className="hook-form-code hook-form-timeout" inputMode="numeric" value={draft.timeout} on_change={field("timeout")} aria-label={t("hooks.timeout_label")} />
        </div>
        {problems.timeout && <p className="hook-note is-danger">{problems.timeout}</p>}
        <div className="hook-form-switch">
          <span>{t("hooks.enabled_label")}</span>
          <Toggle checked={draft.enabled} label={t("hooks.enabled_label")} on_change={field("enabled")} />
        </div>
        <div className="dialog-field">
          <span className="dialog-field-label">{t("hooks.scope_label")}</span>
          <Select
            className="hook-form-select"
            label={t("hooks.scope_label")}
            value={draft.scope}
            placement="bottom-start"
            disabled={scope_options.length < 2}
            options={scope_options}
            on_change={field("scope")}
          />
        </div>
        {error && (
          <p className="hook-note is-danger" role="alert">
            {error}
          </p>
        )}
        <div className="hook-dialog-actions">
          <Button variant="ghost" onClick={on_close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!problems.ready || busy}>
            {t("hooks.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
