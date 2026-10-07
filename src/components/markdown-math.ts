import "katex/dist/katex.min.css";
import type { Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export const remark_plugins: Options["remarkPlugins"] = [remarkGfm, remarkMath];

export const rehype_plugins: Options["rehypePlugins"] = [[rehypeKatex, { strict: false, throwOnError: false, trust: false }]];
