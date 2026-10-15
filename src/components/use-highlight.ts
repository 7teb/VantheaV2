import { useMemo } from "react";
import { lazy_module, use_lazy_module } from "./markdown-lazy.ts";

const highlighter = lazy_module("syntax highlighting", () => import("./markdown-highlight.ts"));

export const use_highlight = (code: string, language: string, wanted: boolean): string | null => {
  const module = use_lazy_module(highlighter, wanted);
  return useMemo(() => (module ? module.highlight_code(code, language) : null), [module, code, language]);
};
