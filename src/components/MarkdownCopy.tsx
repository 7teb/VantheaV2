import { useEffect, useRef, useState } from "react";
import { use_t } from "../i18n/index.ts";
import { copy_text } from "../state/chat-actions.ts";
import { IconButton } from "./Button.tsx";
import { CheckIcon, CopyIcon } from "./icons.tsx";
import "./MarkdownCopy.css";

type CopyButtonProps = { text: string; label?: string; labelled?: boolean };

const copied_ms = 1400;

export const CopyButton = ({ text, label, labelled = false }: CopyButtonProps) => {
  const t = use_t();
  const [copied, set_copied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await copy_text(text))) {
      return;
    }
    set_copied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set_copied(false), copied_ms);
  };

  const name = label ?? t("chat.copy");
  const icon = copied ? <CheckIcon size={labelled ? 13 : 14} /> : <CopyIcon size={labelled ? 13 : 14} />;

  if (labelled) {
    return (
      <button type="button" className="copy-button" onClick={copy} aria-label={name}>
        {icon}
        <span>{copied ? t("chat.copied") : t("chat.copy")}</span>
      </button>
    );
  }

  return (
    <IconButton label={copied ? t("chat.copied") : name} size="sm" onClick={copy}>
      {icon}
    </IconButton>
  );
};
