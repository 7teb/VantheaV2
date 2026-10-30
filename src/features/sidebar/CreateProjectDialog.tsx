import { useState, type FormEvent } from "react";
import { remote_client } from "../../api/bridge.ts";
import { Button, IconButton } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { CloseIcon, FolderIcon, FolderPlusIcon } from "../../components/icons.tsx";
import { TextField } from "../../components/TextField.tsx";
import { use_t } from "../../i18n/index.ts";
import { create_project, pick_project_folder } from "../../state/projects.ts";
import { ipc_error_text } from "../settings/panes/ipc-error.ts";
import { base_name } from "../tools/tool-meta.ts";
import "./CreateProjectDialog.css";

type CreateProjectDialogProps = { open: boolean; on_close: () => void };

export const CreateProjectDialog = ({ open, on_close }: CreateProjectDialogProps) => {
  const t = use_t();
  const [name, set_name] = useState("");
  const [folder, set_folder] = useState<string | null>(null);
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const trimmed = name.trim();

  const close = () => {
    set_name("");
    set_folder(null);
    set_error(null);
    on_close();
  };

  const pick = async () => {
    try {
      const chosen = await pick_project_folder();
      if (chosen) {
        set_folder(chosen);
        set_name((typed) => typed || base_name(chosen));
      }
    } catch (failure) {
      console.error("[projects] choosing a project folder failed", failure);
      set_error(ipc_error_text(failure));
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || busy) {
      return;
    }
    set_busy(true);
    set_error(null);
    try {
      await create_project(trimmed, folder);
      close();
    } catch (failure) {
      console.error(`[projects] creating the project ${trimmed} failed`, failure);
      set_error(t("projects.create_failed", { error: ipc_error_text(failure) }));
    } finally {
      set_busy(false);
    }
  };

  return (
    <Dialog open={open} on_close={close} label={t("projects.create_title")} className="create-project-dialog">
      <form onSubmit={(event) => void submit(event)}>
        <div className="create-project-head">
          <h2 className="confirm-title">{t("projects.create_title")}</h2>
          <IconButton size="sm" label={t("common.close")} onClick={close}>
            <CloseIcon size={14} />
          </IconButton>
        </div>
        <TextField
          value={name}
          on_change={set_name}
          icon={<FolderIcon size={15} />}
          placeholder={t("projects.name_placeholder")}
          aria-label={t("projects.name_placeholder")}
          maxLength={120}
          autoFocus
        />
        <div className="create-project-label">{t("projects.folder_label")}</div>
        <div className="create-project-folder inset-surface">
          {folder ? (
            <div className="create-project-chosen">
              <FolderIcon size={15} />
              <span className="create-project-path" title={folder}>
                {folder}
              </span>
              <IconButton size="sm" label={t("projects.folder_remove")} onClick={() => set_folder(null)}>
                <CloseIcon size={14} />
              </IconButton>
            </div>
          ) : (
            <>
              <p className="create-project-hint">{t("projects.folder_empty", { name: trimmed || t("projects.name_placeholder") })}</p>
              {!remote_client && (
                <Button size="sm" icon={<FolderPlusIcon size={15} />} onClick={() => void pick()}>
                  {t("projects.folder_add")}
                </Button>
              )}
            </>
          )}
        </div>
        {error && (
          <p className="create-project-error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!trimmed || busy}>
            {t("projects.create_submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
