import { Button } from "../../components/Button.tsx";
import { MonitorIcon, StopIcon } from "../../components/icons.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import { use_t } from "../../i18n/index.ts";
import { stop_turn } from "../../state/composer.ts";
import { computer_store } from "../../state/computer.ts";
import { use_store } from "../../state/use-store.ts";
import "./ComputerLiveNote.css";

export const ComputerLiveNote = ({ chat_id }: { chat_id: string }) => {
  const t = use_t();
  const session = use_store(computer_store, (state) => state);
  if (session.chat_id !== chat_id) {
    return null;
  }
  const stop = (
    <Button size="sm" icon={<StopIcon />} aria-label={t("computer.stop_label")} onClick={() => void stop_turn(chat_id)}>
      {t("computer.stop")}
    </Button>
  );
  return (
    <div className="computer-live enter-fade-up">
      <MonitorIcon />
      <span className="computer-live-text is-working">
        <WorkingLetters text={t("computer.live")} />
      </span>
      {session.shortcut ? (
        <Tooltip label={t("computer.stop_label")} hint={t("computer.stop_keys")}>
          {stop}
        </Tooltip>
      ) : (
        stop
      )}
    </div>
  );
};
