import { isValidElement, memo, useMemo, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components, type Options, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { is_external_url, open_external } from "../state/chat-actions.ts";
import { class_names } from "./class-names.ts";
import { has_math, normalize_math, split_blocks } from "./markdown-blocks.ts";
import { lazy_module, use_lazy_module } from "./markdown-lazy.ts";
import { CodeBlock } from "./MarkdownCode.tsx";
import "./Markdown.css";

const math = lazy_module("math", () => import("./markdown-math.ts"));

const plain_plugins: Options["remarkPlugins"] = [remarkGfm];

const local_image = /^(vx-media:|data:image\/)/i;

const url_transform: UrlTransform = (url, key) => (key === "src" && local_image.test(url) ? url : defaultUrlTransform(url));

const follow = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
  event.preventDefault();
  open_external(href);
};

const MarkdownLink = ({ href, children }: { href?: string; children?: ReactNode }) => {
  const target = href && is_external_url(href) ? href : null;
  return (
    <a className="md-link" href={target ?? undefined} title={target ?? undefined} onClick={(event) => follow(event, target ?? "")}>
      {children}
    </a>
  );
};

const MarkdownImage = ({ src, alt }: { src?: string | Blob; alt?: string }) => {
  if (typeof src !== "string" || !src) {
    return null;
  }
  if (local_image.test(src)) {
    return <img className="md-image" src={src} alt={alt ?? ""} loading="lazy" />;
  }
  return <MarkdownLink href={src}>{alt || src}</MarkdownLink>;
};

type CodeProps = { className?: string; children?: ReactNode };

const code_language = (class_name: string | undefined) => /language-([\w+#.-]+)/.exec(class_name ?? "")?.[1] ?? "";

const MarkdownPre = ({ children }: { children?: ReactNode }) => {
  const props: CodeProps = isValidElement<CodeProps>(children) ? children.props : {};
  const code = typeof props.children === "string" ? props.children : String(props.children ?? "");
  return <CodeBlock language={code_language(props.className)} code={code.replace(/\n$/, "")} />;
};

const components: Components = {
  pre: MarkdownPre,
  code: ({ className, children }) => <code className={class_names("md-inline-code", className)}>{children}</code>,
  a: MarkdownLink,
  img: MarkdownImage,
  table: ({ children }) => (
    <div className="md-table inset-surface">
      <table>{children}</table>
    </div>
  ),
};

const MarkdownBlock = memo(({ text }: { text: string }) => {
  const source = normalize_math(text);
  const plugins = use_lazy_module(math, has_math(source));
  return (
    <ReactMarkdown
      remarkPlugins={plugins?.remark_plugins ?? plain_plugins}
      rehypePlugins={plugins?.rehype_plugins}
      components={components}
      urlTransform={url_transform}
    >
      {source}
    </ReactMarkdown>
  );
});

type MarkdownProps = { text: string; className?: string };

export const Markdown = memo(({ text, className }: MarkdownProps) => {
  const blocks = useMemo(() => split_blocks(text), [text]);
  return (
    <div className={class_names("markdown", className)}>
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} text={block} />
      ))}
    </div>
  );
});
