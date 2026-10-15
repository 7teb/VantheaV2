import { normalize_browser_target } from "../../browser/guest-policy.ts";
import { read_choice, read_number, read_string, require_string } from "../browser/common.ts";
import { ToolArgumentError } from "../types.ts";
import { read_string_list } from "./args.ts";
import { time_ranges, type TimeRange } from "./tavily.ts";

export const web_topics = ["general", "news"] as const;

export type WebSearchArgs = { query: string; urls: string[]; offset: number; topic: (typeof web_topics)[number] | null; time_range: TimeRange | null };

const web_address = (entry: string): string => {
  const url = /\s/.test(entry) ? null : normalize_browser_target(entry);
  if (!url || url === "about:blank") {
    throw new ToolArgumentError(`urls entry ${JSON.stringify(entry)} is not an http or https address`);
  }
  return url;
};

const read_offset = (raw: Record<string, unknown>, urls: string[]): number => {
  const offset = read_number(raw, "offset") ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ToolArgumentError("offset must be a whole number of 0 or more");
  }
  if (offset > 0 && urls.length !== 1) {
    throw new ToolArgumentError("offset works only together with exactly one url");
  }
  return offset;
};

export const parse_web_search_args = (raw: Record<string, unknown>): WebSearchArgs => {
  const urls = read_string_list(raw, "urls", 10).map(web_address);
  const topic = read_string(raw, "topic") === null ? null : read_choice(raw, "topic", web_topics, null);
  const time_range = read_string(raw, "time_range") === null ? null : read_choice(raw, "time_range", time_ranges, null);
  const searching = urls.length === 0;
  return { query: require_string(raw, "query").trim(), urls, offset: read_offset(raw, urls), topic: searching ? topic : null, time_range: searching ? time_range : null };
};
