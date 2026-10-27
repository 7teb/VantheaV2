import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChatMeta } from "../../../shared/chat.ts";
import { Button, IconButton } from "../../components/Button.tsx";
import { ArchiveIcon, ComposeIcon, FolderOpenIcon, FolderPlusIcon, PlusIcon, SettingsIcon } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_t } from "../../i18n/index.ts";
import { chats_store, load_chats } from "../../state/chats.ts";
import { choose_project } from "../../state/projects.ts";
import { settings_store } from "../../state/settings.ts";
import { open_settings, start_new_chat, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { shortcut_hint } from "../shell/shortcuts.ts";
import { ActivityView } from "./ActivityView.tsx";
import { ArchivedDialog } from "./ArchivedDialog.tsx";
import { ChatRow } from "./ChatRow.tsx";
import { CreateProjectDialog } from "./CreateProjectDialog.tsx";
import { ProjectGroup } from "./ProjectGroup.tsx";
import { archived_chats, build_sidebar, normalize_path } from "./sidebar-model.ts";
import { SidebarSection as Section } from "./SidebarSection.tsx";
import { SidebarSkeleton } from "./SidebarSkeleton.tsx";
import "./Sidebar.css";

const use_minute_clock = () => {
  const [now, set_now] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => set_now(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

const report = (action: string) => (error: unknown) => console.error(`[sidebar] ${action} failed`, error);

type NavButtonProps = { icon: ReactNode; label: string; hint?: string; on_click: () => void };

const NavButton = ({ icon, label, hint, on_click }: NavButtonProps) => (
  <button type="button" className="sidebar-nav-button" onClick={on_click}>
    {icon}
    <span className="sidebar-nav-label">{label}</span>
    {hint && <kbd className="sidebar-nav-hint">{hint}</kbd>}
  </button>
);

export const Sidebar = () => {
  const t = use_t();
  const now = use_minute_clock();
  const collapsed = use_store(ui_store, (state) => state.sidebar_collapsed);
  const view = use_store(ui_store, (state) => state.sidebar_view);
  const active_chat_id = use_store(ui_store, (state) => state.active_chat_id);
  const project_path = use_store(ui_store, (state) => state.project_path);
  const collapsed_projects = use_store(ui_store, (state) => state.collapsed_projects);
  const chats = use_store(chats_store, (state) => state);
  const projects = use_store(settings_store, (view) => view?.projects ?? null);
  const [add_anchor, set_add_anchor] = useState<HTMLButtonElement | null>(null);
  const [add_open, set_add_open] = useState(false);
  const [archive_open, set_archive_open] = useState(false);
  const [create_open, set_create_open] = useState(false);
  const model = useMemo(() => (projects ? build_sidebar(chats.list, projects) : null), [chats.list, projects]);
  const archived = useMemo(() => archived_chats(chats.list), [chats.list]);
  if (archive_open && archived.length === 0) {
    set_archive_open(false);
  }

  const totals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chat of chats.list) {
      const key = normalize_path(chat.project_path);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [chats.list]);

  const rows = (list: ChatMeta[]) => list.map((chat) => <ChatRow key={chat.id} chat={chat} active={chat.id === active_chat_id} now={now} />);

  const body = () => {
    if (chats.status === "failed") {
      return (
        <div className="sidebar-failed">
          <span>{t("sidebar.load_failed")}</span>
          <Button variant="ghost" onClick={() => load_chats()}>
            {t("common.retry")}
          </Button>
        </div>
      );
    }
    if (chats.status === "loading" || model === null) {
      return <SidebarSkeleton />;
    }
    if (view === "activity") {
      return <ActivityView active_chat_id={active_chat_id} now={now} />;
    }
    return (
      <div className="sidebar-sections enter-fade-up">
        {model.pinned.length > 0 && <Section label={t("sidebar.pinned")}>{rows(model.pinned)}</Section>}
        <Section
          label={t("sidebar.projects")}
          action={
            <IconButton
              ref={set_add_anchor}
              size="sm"
              label={t("projects.add")}
              aria-haspopup="menu"
              aria-expanded={add_open}
              active={add_open}
              onClick={() => set_add_open((was_open) => !was_open)}
            >
              <PlusIcon size={14} />
            </IconButton>
          }
        >
          {model.projects.map((group) => (
            <ProjectGroup
              key={group.project.path}
              group={group}
              chat_total={totals.get(normalize_path(group.project.path)) ?? 0}
              collapsed={collapsed_projects.includes(group.project.path)}
              selected={active_chat_id === null && project_path === group.project.path}
            >
              {rows(group.chats)}
            </ProjectGroup>
          ))}
        </Section>
        {model.loose.length > 0 && <Section label={t("sidebar.no_project")}>{rows(model.loose)}</Section>}
      </div>
    );
  };

  return (
    <aside className="sidebar" data-state={collapsed ? "closed" : "open"} inert={collapsed} aria-label={t("sidebar.navigation")}>
      <div className="sidebar-inner">
        <nav className="sidebar-nav">
          <NavButton icon={<ComposeIcon size={16} />} label={t("sidebar.new_chat")} hint={shortcut_hint("new_chat")} on_click={() => start_new_chat(project_path)} />
        </nav>
        <div className="sidebar-scroll">{body()}</div>
        <div className="sidebar-footer">
          <NavButton icon={<SettingsIcon size={16} />} label={t("sidebar.settings")} hint={shortcut_hint("settings")} on_click={() => open_settings()} />
          {chats.status === "ready" && archived.length > 0 && (
            <Tooltip label={t("sidebar.archived")}>
              <button type="button" className="sidebar-archive" aria-label={t("sidebar.archived")} onClick={() => set_archive_open(true)}>
                <ArchiveIcon size={16} />
                <span className="sidebar-archive-count">{archived.length}</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      <CreateProjectDialog open={create_open} on_close={() => set_create_open(false)} />
      <ArchivedDialog open={archive_open} chats={archived} active_chat_id={active_chat_id} now={now} on_close={() => set_archive_open(false)} />
      <Menu
        open={add_open}
        anchor={add_anchor}
        label={t("projects.add")}
        on_close={() => set_add_open(false)}
        sections={[
          {
            id: "add",
            items: [
              { id: "existing", label: t("projects.add_existing"), icon: <FolderOpenIcon size={15} />, on_select: () => choose_project().catch(report("choosing a project")) },
              { id: "create", label: t("projects.create"), icon: <FolderPlusIcon size={15} />, on_select: () => set_create_open(true) },
            ],
          },
        ]}
      />
    </aside>
  );
};
