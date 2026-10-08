import { useState, type CSSProperties } from "react";
import { use_t } from "../../i18n/index.ts";
import "./DraftLines.css";

export const DraftLines = ({ count }: { count: number }) => {
  const t = use_t();
  const [shown, set_shown] = useState({ count, tick: 0 });
  if (shown.count !== count) {
    set_shown({ count, tick: shown.tick + 1 });
  }
  return (
    <span className="tool-row-detail draft-lines" data-tick={shown.tick % 2} style={{ "--draft-lines": count } as CSSProperties}>
      {t("tools.live_lines_unit")}
    </span>
  );
};
