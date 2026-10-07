import { memo, useMemo } from "react";
import { lazy_module, use_lazy_module } from "./markdown-lazy.ts";
import { CopyButton } from "./MarkdownCopy.tsx";
import "./MarkdownCode.css";

const highlighter = lazy_module("syntax highlighting", () => import("./markdown-highlight.ts"));

const aliases: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  "c++": "cpp",
  cs: "csharp",
  rs: "rust",
  golang: "go",
  sh: "bash",
  zsh: "bash",
  ps1: "powershell",
  ps: "powershell",
  yml: "yaml",
  html: "xml",
  htm: "xml",
  svg: "xml",
  vue: "xml",
  md: "markdown",
  kt: "kotlin",
  text: "plaintext",
  txt: "plaintext",
  console: "shell",
  terminal: "shell",
  toml: "ini",
};

const language_name = (raw: string) => {
  const key = raw.toLowerCase();
  return aliases[key] ?? key;
};

type CodeBlockProps = { language: string; code: string };

export const CodeBlock = memo(({ language, code }: CodeBlockProps) => {
  const name = language_name(language);
  const module = use_lazy_module(highlighter, name !== "" && name !== "plaintext");
  const html = useMemo(() => (module ? module.highlight_code(code, name) : null), [module, code, name]);
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
