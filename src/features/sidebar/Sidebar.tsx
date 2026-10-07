import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChatMeta } from "../../../shared/chat.ts";
import { Button, IconButton } from "../../components/Button.tsx";
import { ComposeIcon, FolderOpenIcon, FolderPlusIcon, PlusIcon, SearchIcon, SettingsIcon } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { use_t } from "../../i18n/index.ts";
import { chats_store, load_chats } from "../../state/chats.ts";
import { choose_project, create_project } from "../../state/projects.ts";
import { settings_store } from "../../state/settings.ts";
import { open_search, open_settings, start_new_chat, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { shortcut_hint } from "../shell/shortcuts.ts";
import { ChatRow } from "./ChatRow.tsx";
import { ProjectGroup } from "./ProjectGroup.tsx";
import { build_sidebar, normalize_path } from "./sidebar-model.ts";
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

const Section = ({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) => (
  <section className="sidebar-section">
    <div className="sidebar-section-head">
      <span className="section-label">{label}</span>
      {action}
    </div>
    {children}
  </section>
);

export const Sidebar = () => {
  const t = use_t();
  const now = use_minute_clock();
  const collapsed = use_store(ui_store, (state) => state.sidebar_collapsed);
  const active_chat_id = use_store(ui_store, (state) => state.active_chat_id);
  const project_path = use_store(ui_store, (state) => state.project_path);
  const collapsed_projects = use_store(ui_store, (state) => state.collapsed_projects);
  const chats = use_store(chats_store, (state) => state);
  const projects = use_store(settings_store, (view) => view?.projects ?? null);
  const [add_anchor, set_add_anchor] = useState<HTMLButtonElement | null>(null);
  const [add_open, set_add_open] = useState(false);
  const model = useMemo(() => (projects ? build_sidebar(chats.list, projects) : null), [chats.list, projects]);

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
          <NavButton icon={<ComposeIcon size={17} />} label={t("sidebar.new_chat")} hint={shortcut_hint("new_chat")} on_click={() => start_new_chat(project_path)} />
          <NavButton icon={<SearchIcon size={17} />} label={t("sidebar.search")} hint={shortcut_hint("search")} on_click={open_search} />
          <NavButton icon={<FolderOpenIcon size={17} />} label={t("sidebar.open_project")} on_click={() => choose_project().catch(report("choosing a project"))} />
        </nav>
        <div className="sidebar-scroll">{body()}</div>
        <div className="sidebar-footer">
          <NavButton icon={<SettingsIcon size={17} />} label={t("sidebar.settings")} hint={shortcut_hint("settings")} on_click={() => open_settings()} />
        </div>
      </div>
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
              { id: "create", label: t("projects.create"), icon: <FolderPlusIcon size={15} />, on_select: () => create_project().catch(report("creating a project")) },
            ],
          },
        ]}
      />
    </aside>
  );
};
