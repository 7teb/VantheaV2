import type { CSSProperties } from "react";
import { use_t } from "../../i18n/index.ts";
import "./DraftLines.css";

export const DraftLines = ({ count }: { count: number }) => {
  const t = use_t();
  return (
    <span className="tool-row-detail draft-lines" data-tick={count % 2} style={{ "--draft-lines": count } as CSSProperties}>
      {t("tools.live_lines_unit")}
    </span>
  );
};
