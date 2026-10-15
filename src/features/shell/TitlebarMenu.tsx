import { useState } from "react";
import { IconButton } from "../../components/Button.tsx";
import { MoreVerticalIcon } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { use_t } from "../../i18n/index.ts";
import { agent_approvals_store } from "../../state/agent-approvals.ts";
import { agents_store, close_agent_run } from "../../state/agents.ts";
import { running_runs } from "../../state/agents-reduce.ts";
import { background_store } from "../../state/background.ts";
import { keep_awake_store, set_keep_awake } from "../../state/keep-awake.ts";
import { toggle_dock, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { dock_toggles } from "./docks.ts";

const toggle_background = () => {
  if (ui_store.get().dock.kind !== "background") {
    close_agent_run();
  }
  toggle_dock("background");
};

export const TitlebarMenu = () => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const active_chat_id = use_store(ui_store, (state) => state.active_chat_id);
  const keep_awake = use_store(keep_awake_store, (state) => state);
  const waiting = use_store(agent_approvals_store, (state) => state.chat_id === active_chat_id && state.approvals.length > 0);
  const running_agents = use_store(agents_store, (state) => (state.chat_id === active_chat_id ? running_runs(state.agents) : 0));
  const running_tasks = use_store(background_store, (state) =>
    state.chat_id === active_chat_id ? state.tasks.filter((task) => task.status === "running").length : 0,
  );
  const running = running_agents + running_tasks;
  const BackgroundIcon = dock_toggles.background.icon;
  const ImagesIcon = dock_toggles.artifacts.icon;

  return (
    <>
      <IconButton
        ref={set_anchor}
        tooltip={false}
        label={t("shell.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        active={open}
        className="titlebar-more"
        onClick={() => set_open(!open)}
      >
        <MoreVerticalIcon size={17} />
        {waiting && <span className="wait-dot titlebar-wait" aria-hidden="true" />}
      </IconButton>
      <Menu
        open={open}
        anchor={anchor}
        label={t("shell.more")}
        placement="bottom-end"
        min_width={240}
        on_close={() => set_open(false)}
        sections={[
          {
            id: "tasks",
            items: [
              {
                id: "background",
                label: t("shell.background_tasks"),
                icon: (
                  <span className="titlebar-menu-icon">
                    <BackgroundIcon size={15} />
                    {waiting && <span className="wait-dot titlebar-menu-wait" aria-hidden="true" />}
                  </span>
                ),
                badge: running > 0 ? String(running) : undefined,
                on_select: toggle_background,
              },
              {
                id: "artifacts",
                label: t(dock_toggles.artifacts.label),
                icon: <ImagesIcon size={15} />,
                on_select: () => toggle_dock("artifacts"),
              },
            ],
          },
          {
            id: "power",
            items: [
              {
                id: "keep_awake",
                label: t("shell.keep_awake"),
                description: t("shell.keep_awake_detail"),
                toggled: keep_awake,
                on_select: () => void set_keep_awake(!keep_awake),
              },
            ],
          },
        ]}
      />
    </>
  );
};
