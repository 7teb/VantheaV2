import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { use_t } from "../i18n/index.ts";
import { copy_text } from "../state/chat-actions.ts";
import { IconButton } from "./Button.tsx";
import { CheckIcon, CopyIcon } from "./icons.tsx";

export type CopyHandle = { copy: () => Promise<boolean> };

type CopyButtonProps = { text: string; label?: string; hint?: string; thin?: boolean; ref?: Ref<CopyHandle> };

const copied_ms = 1400;

export const CopyButton = ({ text, label, hint, thin = false, ref }: CopyButtonProps) => {
  const t = use_t();
  const [copied, set_copied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await copy_text(text))) {
      return false;
    }
    set_copied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set_copied(false), copied_ms);
    return true;
  };

  useImperativeHandle(ref, () => ({ copy }));

  const name = label ?? t("chat.copy");

  return (
    <IconButton label={copied ? t("chat.copied") : name} hint={hint} size="sm" onClick={copy}>
      {copied ? <CheckIcon plain={thin} /> : <CopyIcon plain={thin} />}
    </IconButton>
  );
};
