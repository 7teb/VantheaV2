import type { PermissionMode } from "../../../shared/chat.ts";
import type { ScheduledCard } from "../../../shared/scheduled.ts";
import { ShieldAlertIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { Translate } from "../../i18n/translate.ts";
import { models_store } from "../../state/models.ts";
import { settings_store } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";
import { effort_label } from "../composer/composer-hooks.ts";
import { mode_options } from "../composer/ModePicker.tsx";
import { project_path_label } from "../sidebar/sidebar-model.ts";
import { ApprovalFacts, Fact } from "./ApprovalFacts.tsx";
import { DiffView } from "./DiffView.tsx";
import { command_change } from "./hook-preview.ts";
import { PreviewText } from "./PreviewText.tsx";
import "./approval.css";
import "./bodies-files.css";
import "./scheduled-approval.css";

const ModeValue = ({ mode }: { mode: PermissionMode }) => {
  const t = use_t();
  const label = t((mode_options.find((entry) => entry.id === mode) ?? mode_options[0]).label);
  if (mode !== "full") {
    return label;
  }
  return (
    <span className="approval-fact-icon">
      <ShieldAlertIcon className="mode-danger-icon" />
      {label}
    </span>
  );
};

const use_card_text = () => {
  const t = use_t();
  const catalog = use_store(models_store, (state) => state.catalog);
  const projects = use_store(settings_store, (state) => state?.projects ?? []);
  const model = (card: ScheduledCard) => {
    const label = catalog?.models.find((entry) => entry.id === card.model)?.label ?? card.model;
    return card.effort ? `${label} · ${effort_label(t, card.effort)}` : label;
  };
  const project = (card: ScheduledCard) => (card.project_path ? project_path_label(projects, card.project_path) : t("sidebar.no_project"));
  return { model, project };
};

const every = (t: Translate, card: ScheduledCard) => t(`scheduled.every_${card.interval}`);

const state_text = (t: Translate, enabled: boolean) => t(enabled ? "hooks.state_on" : "hooks.state_off");

export const ScheduledPreview = ({ task, previous }: { task: ScheduledCard; previous: ScheduledCard | null }) => {
  const t = use_t();
  const text = use_card_text();
  const changed = <K extends keyof ScheduledCard>(key: K) => previous !== null && previous[key] !== task[key];
  const model_changed = changed("model") || changed("effort");
  return (
    <div className="scheduled-preview">
      <ApprovalFacts>
        <Fact label={t("scheduled.name_label")} value={task.name} before={previous && changed("name") ? previous.name : null} />
        <Fact label={t("scheduled.card_schedule")} value={every(t, task)} before={previous && changed("interval") ? every(t, previous) : null} />
        <Fact label={t("scheduled.card_mode")} value={<ModeValue mode={task.mode} />} before={previous && changed("mode") ? <ModeValue mode={previous.mode} /> : null} />
        <Fact label={t("scheduled.card_model")} value={text.model(task)} before={previous && model_changed ? text.model(previous) : null} />
        <Fact label={t("scheduled.card_project")} value={text.project(task)} title={task.project_path} before={previous && changed("project_path") ? text.project(previous) : null} />
        {(!task.enabled || changed("enabled")) && (
          <Fact label={t("hooks.state_label")} value={state_text(t, task.enabled)} before={previous && changed("enabled") ? state_text(t, previous.enabled) : null} />
        )}
      </ApprovalFacts>
      {previous && changed("prompt") ? (
        <div className="edit-card">
          <div className="edit-card-head">
            <span>{t("scheduled.card_before")}</span>
          </div>
          <DiffView lines={command_change(previous.prompt, task.prompt)} />
        </div>
      ) : (
        <div className="command-card scheduled-prompt-card">
          <div className="command-card-shell">{t("scheduled.card_prompt")}</div>
          <PreviewText text={task.prompt} />
        </div>
      )}
    </div>
  );
};
