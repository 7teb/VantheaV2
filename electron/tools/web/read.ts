import type { WebFailure } from "../../../shared/tool-view.ts";
import { estimate_tokens, result_cap_tokens, token_prefix } from "../../context/estimate.ts";
import { error_text } from "../../storage/coerce.ts";
import type { ToolResult } from "../types.ts";
import { source_heading } from "./answer.ts";
import { untrusted_note, view_sources, type WebSearchDeps } from "./search.ts";
import { extract_body, failed_extracts, map_extract_results, tavily_post, type SearchDepth, type SourceText } from "./tavily.ts";

export type PageReadInput = { query: string; urls: string[]; depth: SearchDepth; offset: number };

export type PageWindow = { source: SourceText; start: number; end: number };

const reserve_tokens = 1000;

const window_budgets = (pages: SourceText[], offset: number, total_tokens: number): number[] => {
  const needs = pages.map((page) => estimate_tokens(page.content.slice(offset)));
  const order = needs.map((need, index) => ({ need, index })).sort((a, b) => a.need - b.need);
  const budgets = needs.map(() => 0);
  let left = total_tokens;
  order.forEach((entry, position) => {
    const share = Math.min(entry.need, Math.floor(left / (order.length - position)));
    budgets[entry.index] = share;
    left -= share;
  });
  return budgets;
};

const cut_window = (text: string, max_tokens: number): string => {
  const kept = token_prefix(text, max_tokens);
  return kept.length < text.length && /[\uD800-\uDBFF]$/.test(kept) ? kept.slice(0, -1) : kept;
};

export const page_windows = (pages: SourceText[], offset: number, total_tokens: number): PageWindow[] => {
  const budgets = window_budgets(pages, offset, total_tokens);
  return pages.map((source, index) => {
    const start = Math.min(offset, source.content.length);
    const kept = cut_window(source.content.slice(start), budgets[index] ?? 0);
    return { source, start, end: start + kept.length };
  });
};

const range_line = (window: PageWindow): string => {
  const total = window.source.content.length;
  if (!total) {
    return "The page has no extractable text.";
  }
  if (window.start === 0 && window.end === total) {
    return `Complete page, ${total} characters.`;
  }
  const shown = `Characters ${window.start} to ${window.end} of ${total}.`;
  if (window.end === total) {
    return `${shown} This is the end of the page.`;
  }
  return `${shown} The page goes on: call web_search with urls=[${JSON.stringify(window.source.url)}] and offset=${window.end} to read the rest.`;
};

const failure_lines = (failed: WebFailure[]) => failed.map((entry) => `${entry.url}: ${entry.error}`);

export const read_pages = async (input: PageReadInput, deps: WebSearchDeps): Promise<ToolResult> => {
  const view = (sources: SourceText[], failed: WebFailure[]) =>
    ({ kind: "web_search", query: input.query, depth: input.depth, answer: "", sources: view_sources(sources), urls: input.urls, failed }) as const;
  let data: unknown;
  try {
    data = await tavily_post(deps.fetch, deps.key, "/extract", extract_body(input.urls, input.depth), deps.signal);
  } catch (error) {
    if (deps.signal.aborted) {
      throw error;
    }
    console.warn(`[web] reading ${input.urls.join(", ").slice(0, 300)} failed: ${error_text(error)}`);
    return { status: "failed", text: `Reading ${input.urls.join(", ")} failed: ${error_text(error).slice(0, 400)}`, view: view([], []) };
  }
  const pages = map_extract_results(data);
  const failed = failed_extracts(data);
  if (!pages.length) {
    const reasons = failed.length ? failed : input.urls.map((url) => ({ url, error: "Tavily returned no content for this page" }));
    return { status: "failed", text: failure_lines(reasons).map((line) => `Could not read ${line}`).join("\n"), view: view([], reasons) };
  }
  const first = pages[0];
  if (input.offset > 0 && first && input.offset >= first.content.length) {
    return { status: "failed", text: `offset ${input.offset} is past the end of ${first.url}, which has ${first.content.length} characters.`, view: view(pages, failed) };
  }
  const windows = page_windows(pages, input.offset, result_cap_tokens - reserve_tokens);
  const subject = input.urls.length === 1 ? input.urls[0] : `${input.urls.length} pages`;
  const header = `Read ${subject} (${input.depth} extract). ${untrusted_note}`;
  const notes = failed.length ? [`These pages could not be read: ${failure_lines(failed).join("; ")}`] : [];
  const blocks = windows.map((window, index) => `${source_heading(window.source, index)}\n${range_line(window)}\n\n${window.source.content.slice(window.start, window.end)}`);
  return { status: "done", text: [header, ...notes, blocks.join("\n\n---\n\n")].join("\n\n"), view: view(pages, failed) };
};
