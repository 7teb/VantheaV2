import fs from "node:fs/promises";
import { max_walk_entries, project_index, walk_project } from "../../project/index.ts";
import { is_secret_path, resolve_inside } from "../../project/scope.ts";
import { read_text_window } from "../../project/text-window.ts";
import { read_string, require_string } from "../browser/common.ts";
import { define_tool, type ToolProfile } from "../types.ts";
import { failed, format_size, guarded, read_int_arg } from "./common.ts";

const max_listed_files = 1000;

const max_read_lines = 50_000;

const read_max_tokens = 25_000;

export const read_profiles: ToolProfile[] = ["main", "plan", "explore", "worker"];

export const readable_file = async (project_root: string, relative: string) => {
  const scoped = await resolve_inside(project_root, relative);
  if (is_secret_path(scoped.relative)) {
    throw new Error(`${scoped.relative} is a secret file and is not readable by the agent`);
  }
  if (!(await fs.stat(scoped.target)).isFile()) {
    throw new Error(`${scoped.relative} is not a file`);
  }
  return scoped;
};

const listing = async (project_root: string, folder: string | null) => {
  if (!folder) {
    const index = await project_index(project_root);
    return { label: ".", ...index };
  }
  const scoped = await resolve_inside(project_root, folder);
  if (!(await fs.stat(scoped.target)).isDirectory()) {
    throw new Error(`${scoped.relative} is not a folder`);
  }
  return { label: scoped.relative, ...(await walk_project(scoped.root, scoped.target)) };
};

const listing_notes = (shown: number, total: number, walk_truncated: boolean) => {
  const notes: string[] = [];
  if (shown < total) {
    notes.push(`[Showing the first ${shown} of ${total} files. Pass path to list one folder.]`);
  }
  if (walk_truncated) {
    notes.push(`[The folder has more than ${max_walk_entries} entries; the walk stopped there.]`);
  }
  return notes;
};

export const list_files_tool = define_tool<{ path: string | null }>({
  spec: {
    name: "list_files",
    description: "List the project's files with sizes. Dependency, build output and VCS folders and secret files are skipped. path limits the listing to one folder.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Project-relative folder. Defaults to the whole project." } },
      additionalProperties: false,
    },
  },
  profiles: read_profiles,
  parse: (raw) => ({ path: read_string(raw, "path") }),
  run: (ctx, args) =>
    guarded(ctx, "list_files", async () => {
      const result = await listing(ctx.project_root, args.path);
      const files = [...result.files].sort((a, b) => a.path.localeCompare(b.path));
      const shown = files.slice(0, max_listed_files);
      const lines = shown.map((file) => `${file.path} (${format_size(file.size)})`);
      const header = `${files.length} files, ${result.directories.length} folders in ${result.label}`;
      const truncated = shown.length < files.length || result.truncated;
      return {
        status: "done",
        text: [header, ...lines, ...listing_notes(shown.length, files.length, result.truncated)].join("\n"),
        view: { kind: "files", root: result.label, files: shown.map((file) => file.path), directories: result.directories.length, truncated },
      };
    }),
});

type ReadArgs = { path: string; start_line: number; limit: number };

const window_note = (end_line: number, total: number, truncated: boolean) => {
  if (truncated) {
    return `[Truncated at the ${read_max_tokens}-token read limit after line ${end_line} of ${total}. Continue with start_line ${end_line + 1}, or find the relevant region with grep_files or get_file_outline and read only that window.]`;
  }
  return end_line < total ? `[File continues: ${total} lines in total.]` : "";
};

export const read_file_tool = define_tool<ReadArgs>({
  spec: {
    name: "read_file",
    description: "Read a project file as numbered lines. start_line (1-based) and limit select a window; one read returns at most about 25000 tokens and says where it stopped.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative file path." },
        start_line: { type: "number", description: "First line to return, 1-based. Default 1." },
        limit: { type: "number", description: "Number of lines to return." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  profiles: read_profiles,
  parse: (raw) => ({
    path: require_string(raw, "path"),
    start_line: read_int_arg(raw, "start_line", 1, Number.MAX_SAFE_INTEGER) ?? 1,
    limit: read_int_arg(raw, "limit", 1, max_read_lines) ?? max_read_lines,
  }),
  run: (ctx, args) =>
    guarded(ctx, "read_file", async () => {
      const scoped = await readable_file(ctx.project_root, args.path);
      const window = await read_text_window(scoped.target, args.start_line, args.limit, read_max_tokens);
      if (window.binary) {
        return failed(`${scoped.relative} is a binary file and cannot be read as text`);
      }
      if (window.total_lines === 0) {
        const view = { kind: "read" as const, path: scoped.relative, start_line: 1, end_line: 0, total_lines: 0, truncated: false };
        return { status: "done", text: `${scoped.relative} is empty.`, view };
      }
      if (args.start_line > window.total_lines) {
        return failed(`start_line ${args.start_line} is past the end of ${scoped.relative}, which has ${window.total_lines} lines`);
      }
      const note = window_note(window.end_line, window.total_lines, window.truncated);
      return {
        status: "done",
        text: [`${scoped.relative} lines ${window.start_line}-${window.end_line} of ${window.total_lines}`, window.content, note].filter(Boolean).join("\n"),
        view: {
          kind: "read",
          path: scoped.relative,
          start_line: window.start_line,
          end_line: window.end_line,
          total_lines: window.total_lines,
          truncated: window.truncated,
        },
      };
    }),
});
