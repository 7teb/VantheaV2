import { memo } from "react";
import { highlightable, language_name } from "./code-language.ts";
import { CopyButton } from "./MarkdownCopy.tsx";
import { use_highlight } from "./use-highlight.ts";
import "./MarkdownCode.css";

type CodeBlockProps = { language: string; code: string };

export const CodeBlock = memo(({ language, code }: CodeBlockProps) => {
  const name = language_name(language);
  const html = use_highlight(code, name, highlightable(name));
  return (
    <div className="code-block inset-surface">
      <div className="code-block-head">
        <span className="code-block-language">{name || "text"}</span>
        <CopyButton text={code} labelled />
      </div>
      <pre className="code-block-pre">{html === null ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}</pre>
    </div>
  );
});
