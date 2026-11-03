import { useState } from "react";
import type { HookScope, HooksConfig, ScopedHook } from "../../../../shared/hooks.ts";
import type { ProjectEntry } from "../../../../shared/settings.ts";
import { Button } from "../../../components/Button.tsx";
import { PlusIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { settings_store } from "../../../state/settings.ts";
import { use_store } from "../../../state/use-store.ts";
import { normalize_path } from "../../sidebar/sidebar-model.ts";
import { scope_text } from "../../tools/hook-text.ts";
import { SettingsGroup } from "../SettingsLayout.tsx";
import { HookDialog } from "./HookDialog.tsx";
import { HookRow } from "./HookRow.tsx";
import { ListSkeleton } from "./PaneSkeleton.tsx";
import "./hooks.css";
import "./panes.css";

type ScopeGroup = { key: string; scope: HookScope; hooks: ScopedHook[] };

const project_rank = (path: string, projects: ProjectEntry[]): number => {
  const at = projects.findIndex((entry) => normalize_path(entry.path) === normalize_path(path));
  return at < 0 ? projects.length : at;
};

const scope_groups = (hooks: HooksConfig, projects: ProjectEntry[]): ScopeGroup[] => {
  const global: ScopeGroup = { key: "global", scope: { kind: "global" }, hooks: hooks.global.map((hook) => ({ ...hook, scope: { kind: "global" } })) };
  const listed = Object.entries(hooks.projects)
    .map(([path, entries]): ScopeGroup => ({ key: path, scope: { kind: "project", path }, hooks: entries.map((hook) => ({ ...hook, scope: { kind: "project", path } })) }))
    .sort((a, b) => project_rank(a.key, projects) - project_rank(b.key, projects));
  return [global, ...listed].filter((group) => group.hooks.length > 0);
};

export const HooksAddAction = () => {
  const t = use_t();
  const loaded = use_store(settings_store, (state) => state !== null);
  const [adding, set_adding] = useState(false);
  return (
    <>
      <Button icon={<PlusIcon />} disabled={!loaded} onClick={() => set_adding(true)}>
        {t("hooks.add")}
      </Button>
      <HookDialog open={adding} hook={null} on_close={() => set_adding(false)} />
    </>
  );
};

export const HooksPane = () => {
  const t = use_t();
  const settings = use_store(settings_store, (state) => state);
  if (!settings) {
    return (
      <SettingsGroup>
        <ListSkeleton rows={[62, 78]} />
      </SettingsGroup>
    );
  }
  const groups = scope_groups(settings.hooks, settings.projects);
  if (!groups.length) {
    return <p className="pane-note">{t("hooks.empty")}</p>;
  }
  return groups.map((group) => (
    <SettingsGroup key={group.key} label={scope_text(t, group.scope, settings.projects)}>
      {group.hooks.map((hook) => (
        <HookRow key={hook.id} hook={hook} />
      ))}
    </SettingsGroup>
  ));
};
