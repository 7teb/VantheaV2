import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { OutputBlock } from "./OutputBlock.tsx";
import "./CommandCard.css";

export const CommandText = ({ command, prompt = true }: { command: string; prompt?: boolean }) => {
  const t = use_t();
  const text = useRef<HTMLPreElement>(null);
  const [expanded, set_expanded] = useState(false);
  const [clamped, set_clamped] = useState(false);

  useLayoutEffect(() => {
    const node = text.current;
    if (!node || expanded) {
      return;
    }
    const measure = () => set_clamped(node.scrollHeight > node.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [command, expanded]);

  const expand_from_text = () => {
    const selection = window.getSelection();
    if (!clamped || expanded || (selection && !selection.isCollapsed)) {
      return;
    }
    set_expanded(true);
  };

  const label = expanded ? t("tools.command_collapse") : t("tools.command_expand");
  return (
    <div className="command-card-command" data-expanded={expanded} data-clamped={clamped}>
      <pre ref={text} className="command-card-text" data-select-all onClick={expand_from_text}>
        {prompt && <span className="command-card-prompt">{"$ "}</span>}
        {command}
      </pre>
      {clamped && (
        <button type="button" className="command-card-toggle" aria-expanded={expanded} aria-label={label} onClick={() => set_expanded(!expanded)}>
          <ChevronDownIcon />
        </button>
      )}
    </div>
  );
};

const CommandOutput = ({ output, wrap }: { output: string | null; wrap: boolean }) => {
  const t = use_t();
  if (output === null) {
    return null;
  }
  return output ? <OutputBlock text={output} tail className={wrap ? "output-block-wrap" : undefined} /> : <div className="command-card-empty">{t("tools.no_output")}</div>;
};

type CommandCardProps = {
  shell: string;
  command: string;
  output: string | null;
  footer: ReactNode;
  notice?: ReactNode;
  prompt?: boolean;
  wrap?: boolean;
  label_kind?: "shell" | "path";
};

export const CommandCard = ({ shell, command, output, footer, notice = null, prompt = true, wrap = false, label_kind = "shell" }: CommandCardProps) => (
  <div className="command-card">
    {shell && (
      <div className="command-card-shell" data-kind={label_kind}>
        {shell}
      </div>
    )}
    {command && <CommandText command={command} prompt={prompt} />}
    {notice ?? <CommandOutput output={output} wrap={wrap} />}
    {footer && <div className="command-card-footer">{footer}</div>}
  </div>
);
