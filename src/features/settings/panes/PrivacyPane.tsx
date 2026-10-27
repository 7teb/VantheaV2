import { useState } from "react";
import type { WorktreeTarget } from "../../../../shared/ipc/worktrees.ts";
import { Button } from "../../../components/Button.tsx";
import { ConfirmDialog } from "../../../components/Dialog.tsx";
import { use_t, type MessageKey } from "../../../i18n/index.ts";
import { archive_all_chats, delete_all_chats } from "../../../state/chats.ts";
import { remove_all_projects } from "../../../state/projects.ts";
import { settings_store } from "../../../state/settings.ts";
import { WorktreeWarning } from "../../sidebar/WorktreeWarning.tsx";
import { SettingsGroup, SettingsRow } from "../SettingsLayout.tsx";
import { ipc_error_text } from "./ipc-error.ts";
import "./panes.css";

type BulkName = "archive_chats" | "delete_chats" | "remove_projects";

type BulkTexts = { label: MessageKey; sub: MessageKey; button: MessageKey; title: MessageKey };

const bulk_texts: Record<BulkName, BulkTexts> = {
  archive_chats: { label: "privacy.archive_chats", sub: "privacy.archive_chats_sub", button: "privacy.archive_chats_btn", title: "privacy.archive_chats_title" },
  delete_chats: { label: "privacy.delete_chats", sub: "privacy.delete_chats_sub", button: "privacy.delete_chats_btn", title: "privacy.delete_chats_title" },
  remove_projects: { label: "privacy.remove_projects", sub: "privacy.remove_projects_sub", button: "privacy.remove_projects_btn", title: "privacy.remove_projects_title" },
};

type BulkRowProps = { name: BulkName; danger: boolean; warning?: WorktreeTarget; run: () => Promise<string> };

const BulkRow = ({ name, danger, warning, run }: BulkRowProps) => {
  const t = use_t();
  const [confirming, set_confirming] = useState(false);
  const [busy, set_busy] = useState(false);
  const [result, set_result] = useState<string | null>(null);
  const [error, set_error] = useState<string | null>(null);
  const texts = bulk_texts[name];

  const confirm = async () => {
    set_busy(true);
    set_error(null);
    set_result(null);
    try {
      set_result(await run());
    } catch (failure) {
      console.error(`[settings] ${name} failed`, failure);
      set_error(ipc_error_text(failure));
    } finally {
      set_busy(false);
    }
  };

  return (
    <SettingsRow label={t(texts.label)} hint={result ?? t(texts.sub)} error={error}>
      <Button variant={danger ? "danger" : "secondary"} disabled={busy} onClick={() => set_confirming(true)}>
        {t(texts.button)}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t(texts.title)}
        detail={t(texts.sub)}
        confirm_label={t(texts.button)}
        cancel_label={t("common.cancel")}
        danger={danger}
        on_confirm={() => void confirm()}
        on_close={() => set_confirming(false)}
      >
        {warning && <WorktreeWarning target={warning} />}
      </ConfirmDialog>
    </SettingsRow>
  );
};

export const PrivacyPane = () => {
  const t = use_t();

  const archive = async () => {
    const { archived, skipped } = await archive_all_chats();
    return skipped > 0 ? t("privacy.archived_skipped", { n: archived, skipped }) : t("privacy.archived", { n: archived });
  };

  const remove_projects = async () => {
    const count = settings_store.get()?.projects.length ?? 0;
    await remove_all_projects();
    return t("privacy.removed", { n: count });
  };

  return (
    <SettingsGroup label={t("privacy.group")}>
      <BulkRow name="archive_chats" danger={false} run={archive} />
      <BulkRow name="delete_chats" danger warning={{ kind: "all" }} run={async () => t("privacy.deleted", { n: await delete_all_chats() })} />
      <BulkRow name="remove_projects" danger warning={{ kind: "projects" }} run={remove_projects} />
    </SettingsGroup>
  );
};
