import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { api, remote_client } from "../../api/bridge.ts";
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
  const [dropping, set_dropping] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const session = useRef(0);
  const trimmed = name.trim();

  useEffect(() => {
    session.current += 1;
    if (!open) {
      set_name("");
      set_folder(null);
      set_error(null);
      set_busy(false);
      set_dropping(false);
    }
    return () => {
      session.current += 1;
    };
  }, [open]);

  const current = (ticket: number) => open && session.current === ticket;

  const close = () => {
    session.current += 1;
    set_name("");
    set_folder(null);
    set_error(null);
    set_busy(false);
    set_dropping(false);
    on_close();
  };

  const pick = async () => {
    const ticket = session.current;
    try {
      const chosen = await pick_project_folder();
      if (chosen && current(ticket)) {
        choose(chosen);
      }
    } catch (failure) {
      console.error("[projects] choosing a project folder failed", failure);
      if (current(ticket)) {
        set_error(ipc_error_text(failure));
      }
    }
  };

  const choose = (chosen: string) => {
    set_folder(chosen);
    set_name((typed) => typed || base_name(chosen));
  };

  const drop_target = remote_client
    ? {}
    : {
        onDragOver: (event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          set_dropping(true);
        },
        onDragLeave: (event: DragEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            set_dropping(false);
          }
        },
        onDrop: (event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          set_dropping(false);
          const entry = event.dataTransfer.items[0]?.webkitGetAsEntry();
          const file = event.dataTransfer.files[0];
          const dropped = entry?.isDirectory && file ? api.file_path(file) : "";
          if (dropped) {
            choose(dropped);
          }
        },
      };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || busy) {
      return;
    }
    set_busy(true);
    set_error(null);
    const ticket = session.current;
    try {
      await create_project(trimmed, folder, () => current(ticket));
      if (current(ticket)) {
        close();
      }
    } catch (failure) {
      console.error(`[projects] creating the project ${trimmed} failed`, failure);
      if (current(ticket)) {
        set_error(t("projects.create_failed", { error: ipc_error_text(failure) }));
      }
    } finally {
      if (current(ticket)) {
        set_busy(false);
      }
    }
  };

  return (
    <Dialog open={open} on_close={close} label={t("projects.create_title")} className="create-project-dialog" initial_focus={field}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="create-project-head">
          <h2 className="confirm-title">{t("projects.create_title")}</h2>
          <IconButton size="sm" label={t("common.close")} onClick={close}>
            <CloseIcon />
          </IconButton>
        </div>
        <TextField
          ref={field}
          value={name}
          on_change={set_name}
          icon={<FolderIcon />}
          placeholder={t("projects.name_placeholder")}
          aria-label={t("projects.name_placeholder")}
          maxLength={120}
        />
        <div className="create-project-label dialog-field-label">{t("projects.folder_label")}</div>
        <div className="create-project-folder" data-drop={dropping || undefined} {...drop_target}>
          {folder ? (
            <div className="create-project-chosen">
              <FolderIcon />
              <span className="create-project-path" title={folder}>
                {folder}
              </span>
              <IconButton size="sm" label={t("projects.folder_remove")} onClick={() => set_folder(null)}>
                <CloseIcon />
              </IconButton>
            </div>
          ) : (
            <>
              {!remote_client && (
                <div className="create-project-drop">
                  <span>{t("projects.folder_drop")}</span>
                  <Button size="sm" icon={<FolderPlusIcon />} onClick={() => void pick()}>
                    {t("projects.folder_add")}
                  </Button>
                </div>
              )}
              <p className="create-project-hint">{t("projects.folder_empty", { name: trimmed || t("projects.name_placeholder") })}</p>
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
