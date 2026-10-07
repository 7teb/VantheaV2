import { useState, type ReactNode } from "react";
import { IconButton } from "../../components/Button.tsx";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ConfirmDialog } from "../../components/Dialog.tsx";
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, MoreHorizontalIcon, PencilLineIcon, PinIcon, PinOffIcon, TrashIcon } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { use_t } from "../../i18n/index.ts";
import { remove_project, rename_project, set_project_pinned } from "../../state/projects.ts";
import { start_new_chat, toggle_project_collapsed } from "../../state/ui.ts";
import { InlineRename } from "./InlineRename.tsx";
import { project_label, type ProjectGroup as Group } from "./sidebar-model.ts";

type ProjectGroupProps = { group: Group; chat_total: number; collapsed: boolean; selected: boolean; children: ReactNode };

const report = (action: string, path: string) => (error: unknown) => console.error(`[sidebar] ${action} failed for project ${path}`, error);

export const ProjectGroup = ({ group, chat_total, collapsed, selected, children }: ProjectGroupProps) => {
  const t = use_t();
  const { project } = group;
  const label = project_label(project);
  const [menu_anchor, set_menu_anchor] = useState<HTMLButtonElement | null>(null);
  const [menu_open, set_menu_open] = useState(false);
  const [renaming, set_renaming] = useState(false);
  const [confirming, set_confirming] = useState(false);

  return (
    <section className="project-group" data-collapsed={collapsed}>
      <div className="sidebar-row project-row" data-active={selected} data-menu-open={menu_open}>
        <button
          type="button"
          className="project-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("sidebar.show_chats") : t("sidebar.hide_chats")}
          onClick={() => toggle_project_collapsed(project.path)}
        >
          {collapsed ? <FolderIcon size={15} className="project-folder" /> : <FolderOpenIcon size={15} className="project-folder" />}
          <ChevronRightIcon size={13} className="project-chevron" />
        </button>
        {renaming ? (
          <InlineRename
            initial={label}
            label={t("projects.rename_label")}
            on_done={(name) => {
              set_renaming(false);
              if (name !== null) {
                rename_project(project.path, name).catch(report("rename", project.path));
              }
            }}
          />
        ) : (
          <button type="button" className="sidebar-row-main" title={project.path} onClick={() => start_new_chat(project.path)}>
            <span className="sidebar-row-label project-name">{label}</span>
            {project.pinned && <PinIcon size={12} className="project-pin" />}
          </button>
        )}
        {!renaming && (
          <IconButton
            ref={set_menu_anchor}
            size="sm"
            tooltip={false}
            className="sidebar-row-more"
            label={t("projects.options")}
            aria-haspopup="menu"
            aria-expanded={menu_open}
            active={menu_open}
            onClick={() => set_menu_open((was_open) => !was_open)}
          >
            <MoreHorizontalIcon size={15} />
          </IconButton>
        )}
      </div>
      <CollapsibleBody open={!collapsed} className="project-chats">
        {group.chats.length === 0 ? <div className="sidebar-empty">{t("sidebar.no_chats")}</div> : children}
      </CollapsibleBody>
      <Menu
        open={menu_open}
        anchor={menu_anchor}
        label={t("projects.options")}
        on_close={() => set_menu_open(false)}
        sections={[
          {
            id: "project",
            items: [
              { id: "rename", label: t("sidebar.rename"), icon: <PencilLineIcon size={15} />, on_select: () => set_renaming(true) },
              {
                id: "pin",
                label: project.pinned ? t("sidebar.unpin") : t("sidebar.pin"),
                icon: project.pinned ? <PinOffIcon size={15} /> : <PinIcon size={15} />,
                on_select: () => set_project_pinned(project.path, !project.pinned).catch(report("pin", project.path)),
              },
              { id: "delete", label: t("projects.delete"), icon: <TrashIcon size={15} />, danger: true, on_select: () => set_confirming(true) },
            ],
          },
        ]}
      />
      <ConfirmDialog
        open={confirming}
        title={t("projects.delete_title")}
        detail={chat_total > 0 ? t("projects.delete_confirm_chats", { n: chat_total }) : label}
        confirm_label={t("common.delete")}
        cancel_label={t("common.cancel")}
        danger
        on_confirm={() => remove_project(project.path).catch(report("remove", project.path))}
        on_close={() => set_confirming(false)}
      />
    </section>
  );
};
