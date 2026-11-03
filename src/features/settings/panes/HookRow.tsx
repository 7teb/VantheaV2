import { useState } from "react";
import type { ScopedHook } from "../../../../shared/hooks.ts";
import { shell_labels } from "../../../../shared/shell.ts";
import { IconButton } from "../../../components/Button.tsx";
import { ConfirmDialog } from "../../../components/Dialog.tsx";
import { PencilIcon, TrashIcon } from "../../../components/icons.tsx";
import { Toggle } from "../../../components/Toggle.tsx";
import { use_t } from "../../../i18n/index.ts";
import { remove_hook, set_hook_enabled } from "../../../state/hooks.ts";
import { event_label, matcher_text, seconds_text } from "../../tools/hook-text.ts";
import { HookDialog } from "./HookDialog.tsx";
import { ipc_error_text } from "./ipc-error.ts";
import "./hooks.css";
import "./panes.css";

export const HookRow = ({ hook }: { hook: ScopedHook }) => {
  const t = use_t();
  const [editing, set_editing] = useState(false);
  const [confirming, set_confirming] = useState(false);
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const event = event_label(t, hook.event);
  const matcher = matcher_text(t, hook.event, hook.matcher);
  const named = matcher && !matcher.all ? `${event} (${matcher.text})` : event;

  const run = async (channel: string, action: () => Promise<void>) => {
    set_busy(true);
    set_error(null);
    try {
      await action();
    } catch (failure) {
      console.error(`[settings] hooks:${channel} failed for hook ${hook.id}`, failure);
      set_error(ipc_error_text(failure));
    } finally {
      set_busy(false);
    }
  };

  return (
    <div className="pane-item hook-row" data-enabled={hook.enabled}>
      <div className="pane-item-text">
        <div className="pane-item-title hook-row-title">
          <span className="hook-row-event">{event}</span>
          {matcher && <span className={matcher.all ? "hook-row-matcher is-all" : "hook-row-matcher"}>{matcher.text}</span>}
        </div>
        <div className="pane-item-meta hook-row-meta">
          <span className="hook-row-shell">{`${shell_labels[hook.shell]} · ${seconds_text(t, hook.timeout_s)}`}</span>
          <span className="hook-row-command" title={hook.command}>
            {hook.command}
          </span>
        </div>
        {error && <div className="pane-item-error">{error}</div>}
      </div>
      <div className="pane-item-actions is-visible">
        <IconButton size="sm" label={t("hooks.edit")} disabled={busy} onClick={() => set_editing(true)}>
          <PencilIcon />
        </IconButton>
        <IconButton size="sm" label={t("hooks.remove")} disabled={busy} onClick={() => set_confirming(true)}>
          <TrashIcon />
        </IconButton>
        <Toggle checked={hook.enabled} disabled={busy} label={t("hooks.enabled", { x: named })} on_change={(enabled) => void run("set_enabled", () => set_hook_enabled(hook.id, enabled))} />
      </div>
      <HookDialog open={editing} hook={hook} on_close={() => set_editing(false)} />
      <ConfirmDialog
        open={confirming}
        title={t("hooks.remove_title")}
        detail={matcher && !matcher.all ? `${event} · ${matcher.text}` : event}
        confirm_label={t("hooks.remove")}
        cancel_label={t("common.cancel")}
        danger
        on_confirm={() => void run("remove", () => remove_hook(hook.id))}
        on_close={() => set_confirming(false)}
      >
        <pre className="hook-confirm-command inset-surface">{hook.command}</pre>
      </ConfirmDialog>
    </div>
  );
};
