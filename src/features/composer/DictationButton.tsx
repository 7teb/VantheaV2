import { IconButton } from "../../components/Button.tsx";
import { CircleSpinnerIcon, MicIcon, StopIcon } from "../../components/icons.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_t } from "../../i18n/index.ts";
import { cancel_dictation, dictation_store, dictation_supported, start_dictation } from "../../state/dictation.ts";
import { use_store } from "../../state/use-store.ts";
import { DictationWave } from "./DictationWave.tsx";
import "./DictationButton.css";

type DictationButtonProps = { draft_key: string; on_stop: () => void };

export const DictationButton = ({ draft_key, on_stop }: DictationButtonProps) => {
  const t = use_t();
  const phase = use_store(dictation_store, (state) => {
    if (state === null) {
      return null;
    }
    return state.draft_key === draft_key ? state.phase : "elsewhere";
  });

  if (!dictation_supported()) {
    return null;
  }
  if (phase === "recording") {
    return (
      <Tooltip label={t("dictation.stop")}>
        <button type="button" className="dictation-recording" aria-label={t("dictation.stop")} onClick={on_stop}>
          <DictationWave />
          <StopIcon size={16} />
        </button>
      </Tooltip>
    );
  }
  if (phase === "starting" || phase === "transcribing") {
    return (
      <IconButton
        className="dictation-mic"
        label={t(phase === "starting" ? "dictation.starting" : "dictation.transcribing")}
        disabled={phase === "transcribing"}
        onClick={cancel_dictation}
      >
        <CircleSpinnerIcon size={16} className="spin" />
      </IconButton>
    );
  }
  return (
    <IconButton className="dictation-mic" label={t("dictation.dictate")} disabled={phase === "elsewhere"} onClick={() => void start_dictation(draft_key)}>
      <MicIcon size={16} />
    </IconButton>
  );
};
