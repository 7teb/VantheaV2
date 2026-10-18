const fence_pattern = /^ {0,3}(`{3,}|~{3,})/;

const math_fence_pattern = /^ {0,3}\$\$\s*$/;

const opens_fence = (line: string): string | null => {
  const code = fence_pattern.exec(line);
  if (code) {
    return code[1];
  }
  return math_fence_pattern.test(line) ? "$$" : null;
};

const closes_fence = (line: string, fence: string): boolean => {
  if (fence === "$$") {
    return math_fence_pattern.test(line);
  }
  const trimmed = line.trim();
  return trimmed.length >= fence.length && trimmed === fence[0].repeat(trimmed.length);
};

const without_trailing_blank = (lines: string[]): string => {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end).join("\n");
};

const definition_pattern = /^ {0,3}\[\^?[^\]\n]+\]:/;

export const split_blocks = (text: string): string[] => {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let gap = false;
  let defines = false;
  for (const line of text.split("\n")) {
    if (fence !== null) {
      current.push(line);
      if (closes_fence(line, fence)) {
        fence = null;
      }
      continue;
    }
    if (line.trim() === "") {
      if (current.length > 0) {
        gap = true;
        current.push(line);
      }
      continue;
    }
    if (gap && !/^[ \t]/.test(line)) {
      blocks.push(without_trailing_blank(current));
      current = [];
    }
    gap = false;
    current.push(line);
    fence = opens_fence(line);
    defines ||= definition_pattern.test(line);
  }
  if (current.length > 0) {
    blocks.push(without_trailing_blank(current));
  }
  return defines && blocks.length > 1 ? [blocks.join("\n\n")] : blocks;
};

const list_marker_pattern = /^(?:[-+*]|(\d{1,9})[.)])(?=[ \t]|$)/;

const footnote_pattern = /^\[\^[^\]\n]+\]:/;

const heading_pattern = /^#{1,6}(?:[ \t]|$)/;

const html_start_pattern = /^<[A-Za-z/!?]/;

const thematic_break_pattern = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

const setext_pattern = /^(?:=+|-+)[ \t]*$/;

const delimiter_row_pattern = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const table_cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/).length;

const advance = (whitespace: string, column: number) => {
  let at = column;
  for (const char of whitespace) {
    at = char === "\t" ? at + 4 - (at % 4) : at + 1;
  }
  return at;
};

const leading_whitespace = (text: string) => /^[ \t]*/.exec(text)?.[0] ?? "";

type CodeScan = {
  items: number[];
  fence: string | null;
  fence_base: number;
  flow: "paragraph" | "table" | "indented" | "html" | null;
  row: string;
  empty_item: boolean;
};

const quote_column = Number.POSITIVE_INFINITY;

const list_item_column = (marker: RegExpExecArray, after: string, indent: number, interrupting: boolean): number | null => {
  const gap = leading_whitespace(after);
  const empty = gap.length === after.length;
  if (interrupting && (empty || (marker[1] !== undefined && marker[1] !== "1"))) {
    return null;
  }
  const start = indent + marker[0].length;
  const end = advance(gap, start);
  return empty || end - start >= 5 ? start + 1 : end;
};

const scan_line = (scan: CodeScan, source: string): boolean => {
  let line = source;
  for (;;) {
    const lead = leading_whitespace(line);
    const content = line.slice(lead.length);
    const indent = advance(lead, 0);
    if (scan.fence !== null) {
      if (!content || indent >= scan.fence_base) {
        const tilde = scan.fence.startsWith("~");
        if (indent - scan.fence_base < 4 && closes_fence(content, scan.fence)) {
          scan.fence = null;
        }
        return tilde;
      }
      scan.fence = null;
    }
    if (!content.trim()) {
      if (scan.flow !== "indented") {
        scan.flow = null;
      }
      if (scan.empty_item) {
        scan.items.pop();
      }
      scan.empty_item = false;
      return false;
    }
    scan.empty_item = false;
    const open = scan.items.findIndex((column) => indent < column);
    const matched = open < 0 ? scan.items.length : open;
    const base = scan.items[matched - 1] ?? 0;
    if (scan.flow === "html" && open < 0) {
      return false;
    }
    const interrupting = open < 0 && (scan.flow === "paragraph" || scan.flow === "indented");
    if (indent - base < 4) {
      const fence = opens_fence(content);
      if (fence !== null) {
        scan.items.length = matched;
        scan.fence = fence;
        scan.fence_base = base;
        scan.flow = null;
        return fence.startsWith("~");
      }
      if (html_start_pattern.test(content)) {
        scan.items.length = matched;
        scan.flow = "html";
        return false;
      }
      if (open < 0 && scan.flow === "paragraph" && setext_pattern.test(content)) {
        scan.flow = null;
        return false;
      }
      if (heading_pattern.test(content) || thematic_break_pattern.test(content)) {
        scan.items.length = matched;
        scan.flow = null;
        return false;
      }
      if (content.startsWith(">")) {
        scan.items.length = matched;
        scan.items.push(quote_column);
        scan.flow = "paragraph";
        return false;
      }
      const footnote = footnote_pattern.exec(content);
      if (footnote) {
        scan.items.length = matched;
        scan.items.push(base + 4);
        scan.row = content.slice(footnote[0].length).trim();
        scan.flow = scan.row ? "paragraph" : null;
        return false;
      }
      const marker = list_marker_pattern.exec(content);
      const after = content.slice(marker?.[0].length ?? 0);
      const column = marker ? list_item_column(marker, after, indent, interrupting) : null;
      if (marker && column !== null) {
        scan.items.length = matched;
        scan.items.push(column);
        scan.flow = null;
        line = `${lead}${" ".repeat(marker[0].length)}${after}`;
        if (!after.trim()) {
          scan.empty_item = true;
          return false;
        }
        continue;
      }
    }
    const continues = open < 0 && indent - base < 4;
    if (continues && scan.flow === "paragraph" && delimiter_row_pattern.test(content) && table_cells(content) === table_cells(scan.row)) {
      scan.flow = "table";
      return false;
    }
    scan.row = content;
    if (scan.flow === "paragraph" || (continues && scan.flow === "table")) {
      return false;
    }
    scan.items.length = matched;
    scan.flow = indent - base >= 4 ? "indented" : "paragraph";
    return scan.flow === "indented";
  }
};

const code_regions = (text: string): string[] => {
  const regions = [""];
  const scan: CodeScan = { items: [], fence: null, fence_base: 0, flow: null, row: "", empty_item: false };
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const code = scan_line(scan, line);
    if ((regions.length % 2 === 0) !== code) {
      regions.push("");
    }
    regions[regions.length - 1] += index < lines.length - 1 ? `${line}\n` : line;
  }
  return regions;
};

const code_span_pattern = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

const split_code = (text: string): string[] => code_regions(text).flatMap((region, index) => (index % 2 === 1 ? [region] : region.split(code_span_pattern)));

const single_dollar = (text: string, at: number) => text[at] === "$" && text[at - 1] !== "$" && text[at + 1] !== "$" && text[at - 1] !== "\\";

const opens_math = (text: string, at: number) => single_dollar(text, at) && /\S/.test(text[at + 1] ?? "");

const closes_math = (text: string, at: number) => single_dollar(text, at) && /\S/.test(text[at - 1] ?? "") && !/\d/.test(text[at + 1] ?? "");

const math_close = (text: string, open: number): number => {
  for (let at = open + 2; at < text.length && text[at] !== "\n"; at += 1) {
    if (closes_math(text, at)) {
      return at;
    }
  }
  return -1;
};

export const escape_currency = (text: string): string => {
  let out = "";
  let from = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (!single_dollar(text, at)) {
      continue;
    }
    const close = opens_math(text, at) ? math_close(text, at) : -1;
    if (close >= 0) {
      at = close;
      continue;
    }
    out += `${text.slice(from, at)}\\$`;
    from = at + 1;
  }
  return out + text.slice(from);
};

export const normalize_math = (text: string): string =>
  split_code(text)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : escape_currency(
            part
              .replace(/\\\[([\s\S]+?)\\\]/g, (...groups: string[]) => `$$${groups[1]}$$`)
              .replace(/\\\(([\s\S]+?)\\\)/g, (...groups: string[]) => `$${groups[1]?.trim()}$`),
          ),
    )
    .join("");

const math_pattern = /\$\$|\$[^$\n]+\$/;

export const has_math = (text: string): boolean => split_code(text).some((part, index) => index % 2 === 0 && math_pattern.test(part));
