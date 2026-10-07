import { useState } from "react";
import { class_names } from "../../components/class-names.ts";
import { use_t } from "../../i18n/index.ts";

const preview_lines = 30;

type OutputBlockProps = { text: string; tone?: "normal" | "error"; className?: string };

export const OutputBlock = ({ text, tone = "normal", className }: OutputBlockProps) => {
  const t = use_t();
  const [all, set_all] = useState(false);
  const lines = text.split("\n");
  const hidden = lines.length - preview_lines;
  const shown = all || hidden <= 0 ? text : lines.slice(0, preview_lines).join("\n");
  return (
    <div className={class_names("output-block", className)} data-tone={tone}>
      <pre className="output-block-pre inset-surface">{shown}</pre>
      {hidden > 0 && (
        <button type="button" className="output-block-more" onClick={() => set_all(!all)}>
          {all ? t("chat.show_less") : t("tools.preview_more", { n: hidden })}
        </button>
      )}
    </div>
  );
};
