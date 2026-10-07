import { useEffect, useState } from "react";
import type { SkillEntry } from "../../../../shared/ipc/extensions.ts";
import { Button, IconButton } from "../../../components/Button.tsx";
import { CollapsibleBody } from "../../../components/Collapsible.tsx";
import { ConfirmDialog } from "../../../components/Dialog.tsx";
import { EyeIcon, EyeOffIcon, FolderOpenIcon, RetryIcon, TrashIcon } from "../../../components/icons.tsx";
import { SkeletonLines } from "../../../components/Skeleton.tsx";
import { Toggle } from "../../../components/Toggle.tsx";
import { use_t } from "../../../i18n/index.ts";
import { load_skills, open_skills_folder, remove_skill, set_skill_enabled, skill_body, skills_store } from "../../../state/extensions.ts";
import { use_store } from "../../../state/use-store.ts";
import { SettingsGroup, SettingsRow } from "../SettingsLayout.tsx";
import { ipc_error_text } from "./ipc-error.ts";
import { ListSkeleton } from "./PaneSkeleton.tsx";
import "./panes.css";

const SkillRow = ({ skill }: { skill: SkillEntry }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const [text, set_text] = useState<string | null>(null);
  const [confirming, set_confirming] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const run = async (label: string, action: () => Promise<void>) => {
    set_error(null);
    try {
      await action();
    } catch (failure) {
      console.error(`[settings] ${label} failed for skill ${skill.slug}`, failure);
      set_error(ipc_error_text(failure));
    }
  };

  const toggle_body = async () => {
    set_open(!open);
    if (open || text !== null) {
      return;
    }
    set_error(null);
    try {
      set_text(await skill_body(skill.slug));
    } catch (failure) {
      console.error(`[settings] skills:body failed for skill ${skill.slug}`, failure);
      set_open(false);
      set_error(ipc_error_text(failure));
    }
  };

  const meta = skill.files.length > 0 ? ` · ${t("skills.files", { n: skill.files.length })}` : "";

  return (
    <div className="pane-item is-stacked">
      <div className="pane-item-row">
        <div className="pane-item-text">
          <div className="pane-item-title">{skill.name}</div>
          <div className="pane-item-meta">
            {skill.description || skill.slug}
            {meta}
          </div>
          {error && <div className="pane-item-error">{error}</div>}
        </div>
        <div className="pane-item-actions is-visible">
          <IconButton size="sm" label={open ? t("skills.hide") : t("skills.view")} onClick={() => void toggle_body()}>
            {open ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
          </IconButton>
          <IconButton size="sm" label={t("skills.remove")} onClick={() => set_confirming(true)}>
            <TrashIcon size={14} />
          </IconButton>
          <Toggle
            checked={skill.enabled}
            label={t("skills.enable", { x: skill.name })}
            on_change={(enabled) => void run("skills:set_enabled", () => set_skill_enabled(skill.slug, enabled))}
          />
        </div>
      </div>
      <CollapsibleBody open={open}>
        {text === null ? <SkeletonLines className="pane-code-skeleton" widths={[64, 88, 52, 74]} /> : <pre className="pane-code inset-surface">{text}</pre>}
      </CollapsibleBody>
      <ConfirmDialog
        open={confirming}
        title={t("skills.remove_confirm", { x: skill.name })}
        confirm_label={t("skills.remove")}
        cancel_label={t("common.cancel")}
        danger
        on_confirm={() => void run("skills:remove", () => remove_skill(skill.slug))}
        on_close={() => set_confirming(false)}
      />
    </div>
  );
};

export const SkillsPane = () => {
  const t = use_t();
  const status = use_store(skills_store, (state) => state.status);
  const skills = use_store(skills_store, (state) => state.items);
  const [error, set_error] = useState<string | null>(null);

  useEffect(() => {
    void load_skills();
  }, []);

  const open_folder = async () => {
    set_error(null);
    try {
      await open_skills_folder();
    } catch (failure) {
      console.error("[settings] skills:open_folder failed", failure);
      set_error(ipc_error_text(failure));
    }
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow label={t("skills.folder")} hint={t("skills.folder_sub")} error={error}>
          <IconButton label={t("skills.reload")} onClick={() => void load_skills()}>
            <RetryIcon size={15} />
          </IconButton>
          <Button icon={<FolderOpenIcon size={15} />} onClick={() => void open_folder()}>
            {t("skills.open")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
      {status === "loading" && (
        <SettingsGroup>
          <ListSkeleton rows={[52, 68, 44]} />
        </SettingsGroup>
      )}
      {status === "failed" && <p className="pane-note">{t("skills.load_failed")}</p>}
      {status === "ready" && skills.length === 0 && <p className="pane-note">{t("skills.empty")}</p>}
      {status === "ready" && skills.length > 0 && (
        <SettingsGroup>
          {skills.map((skill) => (
            <SkillRow key={skill.slug} skill={skill} />
          ))}
        </SettingsGroup>
      )}
    </>
  );
};
