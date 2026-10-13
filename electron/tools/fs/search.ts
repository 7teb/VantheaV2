import { grep_project, max_grep_matches, type GrepQuery } from "../../project/grep.ts";
import { file_outline } from "../../project/outline.ts";
import { read_boolean, read_string, require_string } from "../browser/common.ts";
import { define_tool } from "../types.ts";
import { guarded } from "./common.ts";
import { read_profiles, readable_file } from "./read.ts";

const search_header = (query: GrepQuery, count: number, files: number, mode: string) =>
  `${count} matching lines for ${JSON.stringify(query.query)} (${mode}, ${query.case_sensitive ? "case-sensitive" : "case-insensitive"}) in ${files} ${files === 1 ? "file" : "files"}${query.path ? ` under ${query.path}` : ""}`;

export const grep_files_tool = define_tool<GrepQuery>({
  spec: {
    name: "grep_files",
    description: `Search the project's text files line by line with ripgrep. Files listed in .gitignore, binary files, secret files and generated folders (node_modules, dist, build, bin, obj and similar) are skipped. Default: literal, case-insensitive substring. regex: true uses a ripgrep regular expression (Rust syntax; lookaround and backreferences work through PCRE2); case_sensitive: true matches exact case; path limits the search to one folder or file. Returns at most ${max_grep_matches} matching lines and says when the result is capped.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string", description: "Project-relative folder or file. Defaults to the whole project." },
        regex: { type: "boolean" },
        case_sensitive: { type: "boolean" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  profiles: read_profiles,
  parse: (raw) => ({
    query: require_string(raw, "query"),
    path: read_string(raw, "path") ?? "",
    regex: read_boolean(raw, "regex", false),
    case_sensitive: read_boolean(raw, "case_sensitive", false),
  }),
  run: (ctx, args) =>
    guarded(ctx, "grep_files", async () => {
      const result = await grep_project(ctx.project_root, args, ctx.signal, (count) =>
        ctx.progress({ label: `${count} ${count === 1 ? "match" : "matches"}`, lines: null, output_tail: null }),
      );
      const notes: string[] = [];
      if (result.regex_error) {
        notes.push(`[The regex is invalid (${result.regex_error}); the query was matched as a literal string instead.]`);
      }
      if (result.capped) {
        notes.push(`[Capped at ${max_grep_matches} lines: more matches exist and this list is incomplete. Narrow the query or path and search again.]`);
      }
      const lines = result.matches.map((match) => `${match.path}:${match.line}: ${match.text}`);
      return {
        status: "done",
        text: [search_header(args, result.matches.length, result.files_scanned, result.mode), ...notes, ...lines].join("\n"),
        view: { kind: "grep", query: args.query, matches: result.matches, total: result.matches.length, truncated: result.capped },
      };
    }),
});

export const get_file_outline_tool = define_tool<{ path: string }>({
  spec: {
    name: "get_file_outline",
    description: "List the classes, functions, methods and types declared in a source file with their line numbers.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Project-relative file path." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  profiles: read_profiles,
  parse: (raw) => ({ path: require_string(raw, "path") }),
  run: (ctx, args) =>
    guarded(ctx, "get_file_outline", async () => {
      const scoped = await readable_file(ctx.project_root, args.path);
      const outline = await file_outline(scoped.target);
      const lines = outline.symbols.map((symbol) => `${"  ".repeat(symbol.depth)}${symbol.kind} ${symbol.name} (line ${symbol.line})`);
      const header = outline.symbols.length ? `${outline.symbols.length} symbols in ${scoped.relative}` : `No declarations recognized in ${scoped.relative}`;
      const note = outline.capped ? "[Outline capped; read the rest of the file with read_file.]" : "";
      return {
        status: "done",
        text: [header, ...lines, note].filter(Boolean).join("\n"),
        view: { kind: "outline", path: scoped.relative, symbols: outline.symbols },
      };
    }),
});
