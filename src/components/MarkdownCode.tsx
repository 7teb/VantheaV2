import { memo } from "react";
import { use_t } from "../i18n/index.ts";
import { run_in_terminal } from "../state/terminal.ts";
import { IconButton } from "./Button.tsx";
import { highlightable, language_name, runnable_command } from "./code-language.ts";
import { PlayIcon } from "./icons.tsx";
import { CopyButton } from "./MarkdownCopy.tsx";
import { use_highlight } from "./use-highlight.ts";
import "./MarkdownCode.css";

type CodeBlockProps = { language: string; code: string };

export const CodeBlock = memo(({ language, code }: CodeBlockProps) => {
  const t = use_t();
  const name = language_name(language);
  const html = use_highlight(code, name, highlightable(name));
  const command = runnable_command(name, code);
  return (
    <div className="code-block inset-surface">
      <div className="code-block-head">
        <span className="code-block-language">{name || "text"}</span>
        <span className="code-block-actions">
          {command !== null && (
            <IconButton label={t("chat.run_in_terminal")} size="sm" onClick={() => run_in_terminal(command)}>
              <PlayIcon plain />
            </IconButton>
          )}
          <CopyButton text={code} thin />
        </span>
      </div>
      <pre className="code-block-pre" data-select-all>{html === null ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}</pre>
    </div>
  );
});
