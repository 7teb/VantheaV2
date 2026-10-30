import { useState } from "react";
import { IconButton } from "../../components/Button.tsx";
import { SmartphoneIcon } from "../../components/icons.tsx";
import { Popover } from "../../components/Popover.tsx";
import { use_t } from "../../i18n/index.ts";
import { remote_store } from "../../state/remote.ts";
import { use_store } from "../../state/use-store.ts";
import { RemotePanel } from "./RemotePanel.tsx";
import "./RemoteToggle.css";

export const RemoteToggle = () => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const on = use_store(remote_store, (status) => status?.state === "on");

  return (
    <>
      <IconButton
        ref={set_anchor}
        label={t("remote.title")}
        aria-haspopup="dialog"
        aria-expanded={open}
        active={open}
        className="titlebar-remote"
        onClick={() => set_open(!open)}
      >
        <SmartphoneIcon size={17} />
        {on && <span className="remote-dot" aria-hidden="true" />}
      </IconButton>
      <Popover open={open} anchor={anchor} label={t("remote.title")} placement="bottom-end" min_width={320} className="remote-popover" on_close={() => set_open(false)}>
        <RemotePanel />
      </Popover>
    </>
  );
};
