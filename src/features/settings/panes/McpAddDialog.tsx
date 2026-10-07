import { useState, type FormEvent } from "react";
import { Button } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { FolderOpenIcon } from "../../../components/icons.tsx";
import { TextArea, TextField } from "../../../components/TextField.tsx";
import { use_t } from "../../../i18n/index.ts";
import { detect_mcp_folder, upsert_mcp_server } from "../../../state/extensions.ts";
import { ipc_error_text } from "./ipc-error.ts";
import { config_draft, draft_config, empty_draft, parse_pasted_config, valid_server_name, type McpDraft } from "./mcp-config.ts";

type McpAddDialogProps = { open: boolean; existing: string[]; on_close: () => void };

export const McpAddDialog = ({ open, existing, on_close }: McpAddDialogProps) => {
  const t = use_t();
  const [draft, set_draft] = useState<McpDraft>(empty_draft);
  const [paste, set_paste] = useState("");
  const [note, set_note] = useState<string | null>(null);
  const [error, set_error] = useState<string | null>(null);
  const [busy, set_busy] = useState(false);

  const name = draft.name.trim();
  const taken = existing.includes(name);
  const ready = valid_server_name(name) && !taken && draft.command.trim() !== "";

  const close = () => {
    set_draft(empty_draft);
    set_paste("");
    set_note(null);
    set_error(null);
    on_close();
  };

  const field = (key: keyof McpDraft) => (value: string) => set_draft((current) => ({ ...current, [key]: value }));

  const detect = async () => {
    set_note(null);
    set_busy(true);
    try {
      const found = await detect_mcp_folder();
      if (found) {
        set_draft(config_draft(found.name, found.config));
        set_paste("");
      }
    } catch (failure) {
      console.error("[settings] mcp:detect_folder failed", failure);
      set_note(`${t("mcp.detect_fail")} ${ipc_error_text(failure)}`);
    } finally {
      set_busy(false);
    }
  };

  const apply_paste = (text: string) => {
    set_paste(text);
    const parsed = parse_pasted_config(text, draft.name);
    if (parsed) {
      set_draft(parsed);
    }
    set_note(text.trim() !== "" && !parsed ? t("mcp.paste_invalid") : null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) {
      return;
    }
    set_busy(true);
    set_error(null);
    try {
      await upsert_mcp_server(name, draft_config(draft));
      close();
    } catch (failure) {
      console.error(`[settings] mcp:upsert failed for new server ${name}`, failure);
      set_error(ipc_error_text(failure));
    } finally {
      set_busy(false);
    }
  };

  const name_error = () => {
    if (name === "") {
      return null;
    }
    if (taken) {
      return t("mcp.name_taken");
    }
    return valid_server_name(name) ? null : t("mcp.name_invalid");
  };

  return (
    <Dialog open={open} on_close={close} label={t("mcp.add_title")} className="mcp-dialog">
      <form className="mcp-form" onSubmit={save}>
        <h2 className="mcp-dialog-title">{t("mcp.add_title")}</h2>
        <Button icon={<FolderOpenIcon size={15} />} disabled={busy} onClick={() => void detect()}>
          {t("mcp.choose_plugin")}
        </Button>
        <div className="mcp-divider">{t("mcp.or_paste")}</div>
        <TextArea className="mcp-paste" value={paste} rows={4} placeholder={t("mcp.paste_placeholder")} aria-label={t("mcp.or_paste")} on_change={apply_paste} />
        {note && <p className="mcp-note">{note}</p>}
        <div className="mcp-divider">{t("mcp.or_manual")}</div>
        <TextField value={draft.name} on_change={field("name")} placeholder={t("mcp.name_label")} aria-label={t("mcp.name_label")} />
        {name_error() && <p className="mcp-note is-danger">{name_error()}</p>}
        <TextField value={draft.command} on_change={field("command")} placeholder={t("mcp.command_label")} aria-label={t("mcp.command_label")} />
        <TextArea className="mcp-lines" value={draft.args} rows={3} on_change={field("args")} placeholder={t("mcp.args_label")} aria-label={t("mcp.args_label")} />
        <TextArea className="mcp-lines" value={draft.env} rows={2} on_change={field("env")} placeholder={t("mcp.env_label")} aria-label={t("mcp.env_label")} />
        <TextField value={draft.cwd} on_change={field("cwd")} placeholder={t("mcp.cwd_label")} aria-label={t("mcp.cwd_label")} />
        {error && (
          <p className="mcp-note is-danger" role="alert">
            {error}
          </p>
        )}
        <div className="mcp-dialog-actions">
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!ready || busy}>
            {t("mcp.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
