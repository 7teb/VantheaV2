import { useLayoutEffect, useRef } from "react";
import type { ComputerSession } from "../../../shared/ipc/computer.ts";
import { api } from "../../api/bridge.ts";
import { Button } from "../../components/Button.tsx";
import { MonitorIcon, StopIcon } from "../../components/icons.tsx";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import { use_t } from "../../i18n/index.ts";
import { computer_store } from "../../state/computer.ts";
import { use_store } from "../../state/use-store.ts";
import "./ComputerIndicator.css";

const select_shortcut = (session: ComputerSession) => session.shortcut;

export const ComputerIndicator = () => {
  const t = use_t();
  const shortcut = use_store(computer_store, select_shortcut);
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const box = node.getBoundingClientRect();
      api.send("computer:indicator_size", Math.ceil(box.width), Math.ceil(box.height));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={stage} className="computer-indicator-stage">
      <div className="computer-indicator" role="status">
        <MonitorIcon />
        <span className="computer-indicator-text is-working">
          <WorkingLetters text={t("computer.overlay")} />
        </span>
        {shortcut && <kbd className="computer-indicator-keys">{t("computer.stop_keys")}</kbd>}
        <Button size="sm" icon={<StopIcon />} aria-label={t("computer.stop_label")} onClick={() => api.send("computer:stop")}>
          {t("computer.stop")}
        </Button>
      </div>
    </div>
  );
};
