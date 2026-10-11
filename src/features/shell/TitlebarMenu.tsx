import { useState } from "react";
import { IconButton } from "../../components/Button.tsx";
import { MoreVerticalIcon } from "../../components/icons.tsx";
import { Menu } from "../../components/Menu.tsx";
import { use_t } from "../../i18n/index.ts";
import { background_store, load_background } from "../../state/background.ts";
import { keep_awake_store, set_keep_awake } from "../../state/keep-awake.ts";
import { toggle_dock, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { dock_toggles } from "./docks.ts";

export const TitlebarMenu = () => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const active_chat_id = use_store(ui_store, (state) => state.active_chat_id);
  const keep_awake = use_store(keep_awake_store, (state) => state);
  const running = use_store(background_store, (state) =>
    state.chat_id === active_chat_id ? state.tasks.filter((task) => task.status === "running").length : 0,
  );
  const BackgroundIcon = dock_toggles.background.icon;

  const toggle_open = () => {
    if (!open) {
      void load_background(active_chat_id);
    }
    set_open(!open);
  };

  return (
    <>
      <IconButton
        ref={set_anchor}
        tooltip={false}
        label={t("shell.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        active={open}
        onClick={toggle_open}
      >
        <MoreVerticalIcon size={17} />
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
                icon: <BackgroundIcon size={15} />,
                badge: running > 0 ? String(running) : undefined,
                on_select: () => toggle_dock("background"),
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
