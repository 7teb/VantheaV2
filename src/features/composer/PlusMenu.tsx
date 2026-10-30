import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { remote_client } from "../../api/bridge.ts";
import { BookOpenIcon, ClipboardListIcon, FolderOpenIcon, PaperclipIcon, PlugIcon, type IconComponent } from "../../components/icons.tsx";
import { ToggleTrack } from "../../components/Toggle.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { draft_key as key_for, type Draft, type DraftChip } from "../../state/chat-drafts.ts";
import { carry_new_draft, set_composer_error, toggle_draft_chip, toggle_plan } from "../../state/composer.ts";
import { load_mcp, load_skills, mcp_store, skills_store } from "../../state/extensions.ts";
import { choose_project } from "../../state/projects.ts";
import { settings_store } from "../../state/settings.ts";
import { open_settings } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { normalize_path, project_label } from "../sidebar/sidebar-model.ts";
import { step_enabled } from "./command-menu.ts";
import { ComposerPopover } from "./ComposerPopover.tsx";
import { MenuRow } from "./MenuRow.tsx";
import { SourceList, usable_skills, type SourceTab } from "./PlusSources.tsx";
import { WorktreeRow } from "./WorktreeRow.tsx";

type PlusMenuProps = {
  open: boolean;
  keep: (target: Node) => boolean;
  chat_id: string | null;
  project_path: string;
  draft_key: string;
  draft: Draft;
  on_close: () => void;
  on_files: () => void;
};

const tabs: { id: SourceTab; icon: IconComponent; label: MessageKey }[] = [
  { id: "skills", icon: BookOpenIcon, label: "commands.skills" },
  { id: "mcp", icon: PlugIcon, label: "commands.mcp" },
];

const nav_selector = ".composer-popover-row:not(:disabled), .composer-popover-tab";

type Step = 1 | -1 | "first" | "last";

const steps: Record<string, Step> = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" };

const move_focus = (container: HTMLElement, step: Step) => {
  const targets = [...container.querySelectorAll<HTMLElement>(nav_selector)];
  if (targets.length === 0) {
    return;
  }
  if (step === "first" || step === "last") {
    targets[step === "first" ? 0 : targets.length - 1].focus();
    return;
  }
  const current = targets.findIndex((target) => target === document.activeElement);
  targets[step_enabled(targets.map(() => ({ disabled: false })), current, step)].focus();
};

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

const plan_index = remote_client ? 1 : 2;

export const PlusMenu = ({ open, keep, chat_id, project_path, draft_key, draft, on_close, on_files }: PlusMenuProps) => {
  const t = use_t();
  const base = useId();
  const [tab, set_tab] = useState<SourceTab>("skills");
  const tab_buttons = useRef<Partial<Record<SourceTab, HTMLButtonElement | null>>>({});
  const skills = use_store(skills_store, (state) => state);
  const servers = use_store(mcp_store, (state) => state);
  const project = use_store(settings_store, (state) => state?.projects.find((entry) => normalize_path(entry.path) === normalize_path(project_path)) ?? null);

  useEffect(() => {
    if (open) {
      void load_skills();
      void load_mcp();
    }
  }, [open]);

  const counts: Record<SourceTab, number> = { skills: usable_skills(skills).length, mcp: servers.items.length };

  const switch_tab = (next: SourceTab) => {
    set_tab(next);
    tab_buttons.current[next]?.focus();
  };

  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move_focus(event.currentTarget, step);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      switch_tab(tab === "skills" ? "mcp" : "skills");
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      on_close();
    }
  };

  const work_in_project = async () => {
    try {
      const entry = await choose_project();
      if (entry && chat_id === null) {
        carry_new_draft(draft_key, key_for(null, entry.path));
      }
    } catch (error) {
      console.error(`[composer] choosing a project from the add menu failed for draft ${draft_key}`, error);
      set_composer_error(draft_key, t("commands.failed", { action: t("commands.project"), error: error_text(error) }));
    }
  };

  const add_chip = (chip: DraftChip) => {
    toggle_draft_chip(draft_key, chip);
    on_close();
  };

  const manage = (section: SourceTab) => {
    on_close();
    open_settings(section);
  };

  return (
    <ComposerPopover open={open} label={t("commands.plus")} focus="menu" keep={keep} on_close={on_close} on_key_down={on_key_down}>
      <div className="composer-popover-label" id={`${base}-add`}>
        {t("commands.add")}
      </div>
      <div role="menu" aria-labelledby={`${base}-add`}>
        <MenuRow
          icon={PaperclipIcon}
          label={t("commands.files")}
          index={0}
          on_select={() => {
            on_close();
            on_files();
          }}
        />
        {!remote_client && (
          <MenuRow
            icon={FolderOpenIcon}
            label={t("commands.project")}
            hint={project ? project_label(project) : t("commands.no_project")}
            index={1}
            on_select={() => {
              on_close();
              void work_in_project();
            }}
          />
        )}
        <MenuRow
          icon={ClipboardListIcon}
          label={t("commands.plan")}
          trail={<ToggleTrack checked={draft.plan} />}
          role="menuitemcheckbox"
          checked={draft.plan}
          index={plan_index}
          on_select={() => toggle_plan(draft_key)}
        />
        <WorktreeRow open={open} chat_id={chat_id} project_path={project_path} draft_key={draft_key} index={plan_index + 1} />
      </div>
      <div className="composer-popover-divider" role="separator" />
      <div className="composer-popover-tabs" role="tablist" aria-label={t("commands.sources")}>
        {tabs.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              ref={(node) => {
                tab_buttons.current[entry.id] = node;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`${base}-panel`}
              tabIndex={-1}
              className="composer-popover-tab"
              onClick={() => set_tab(entry.id)}
            >
              <Icon size={14} />
              <span>{t(entry.label)}</span>
              {counts[entry.id] > 0 && <span className="composer-popover-count">{counts[entry.id]}</span>}
            </button>
          );
        })}
      </div>
      <div key={tab} className="composer-popover-list" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tab}`}>
        <SourceList tab={tab} label_id={`${base}-tab-${tab}`} skills={skills} servers={servers} draft={draft} on_chip={add_chip} on_manage={manage} />
      </div>
    </ComposerPopover>
  );
};
