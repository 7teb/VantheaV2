import { memo } from "react";
import type { DiffLine } from "../../../shared/tool-view.ts";
import { use_t } from "../../i18n/index.ts";
import "./DiffView.css";

const sign: Record<DiffLine["kind"], string> = { add: "+", remove: "-", context: "", gap: "" };

export const DiffView = memo(({ lines }: { lines: DiffLine[] }) => {
  const t = use_t();
  if (lines.length === 0) {
    return <div className="diff-empty">{t("tools.diff_empty")}</div>;
  }
  return (
    <div className="diff-view inset-surface">
      {lines.map((line, index) =>
        line.kind === "gap" ? (
          <div key={index} className="diff-gap">
            <span>{t("tools.diff_gap")}</span>
          </div>
        ) : (
          <div key={index} className="diff-row" data-kind={line.kind}>
            <span className="diff-gutter">{line.old_line ?? ""}</span>
            <span className="diff-gutter">{line.new_line ?? ""}</span>
            <span className="diff-sign">{sign[line.kind]}</span>
            <span className="diff-code">{line.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
});
