import type { ToolView } from "../../../shared/tool-view.ts";
import { commit_edit, prepare_replace, prepare_write, type PreparedEdit } from "../../project/edit.ts";
import { require_string } from "../browser/common.ts";
import { define_tool, ToolArgumentError, type ToolContext, type ToolProfile, type ToolResult } from "../types.ts";
import { denied, guarded, read_int_arg, read_text_arg } from "./common.ts";

const write_profiles: ToolProfile[] = ["main", "worker"];

const edit_view = (prepared: PreparedEdit): ToolView => ({
  kind: "edit",
  path: prepared.target.relative,
  created: prepared.previous === null,
  added: prepared.diff.added,
  removed: prepared.diff.removed,
  diff: prepared.diff.lines,
});

const apply_edit = async (ctx: ToolContext, prepared: PreparedEdit, summary: string): Promise<ToolResult> => {
  const view = edit_view(prepared);
  if (ctx.mode === "ask") {
    const decision = await ctx.approve({
      kind: "write",
      path: prepared.target.relative,
      created: prepared.previous === null,
      added: prepared.diff.added,
      removed: prepared.diff.removed,
      diff: prepared.diff.lines,
    });
    if (!decision.approved) {
      return denied(`the edit to ${prepared.target.relative}`, decision);
    }
  }
  await commit_edit(prepared, ctx.turn_id);
  return { status: "done", text: `${summary} (+${prepared.diff.added} -${prepared.diff.removed} lines)`, view };
};

export const write_file_tool = define_tool<{ path: string; content: string }>({
  spec: {
    name: "write_file",
    description: "Create a file or overwrite it with the given UTF-8 text. path is project-relative; missing folders are created. Prefer replace_in_file for small changes to an existing file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string", description: "The complete file text." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  profiles: write_profiles,
  parse: (raw) => ({ path: require_string(raw, "path"), content: read_text_arg(raw, "content") }),
  run: (ctx, args) =>
    guarded(ctx, "write_file", async () => {
      const prepared = await prepare_write(ctx.project_root, args.path, args.content);
      if (prepared.previous === args.content) {
        return { status: "done", text: `${prepared.target.relative} already has exactly this content; nothing was written.`, view: edit_view(prepared) };
      }
      const verb = prepared.previous === null ? "Created" : "Overwrote";
      return apply_edit(ctx, prepared, `${verb} ${prepared.target.relative} (${Buffer.byteLength(args.content, "utf8")} bytes)`);
    }),
});

type ReplaceArgs = { path: string; old_string: string; new_string: string; expected: number };

const parse_replace = (raw: Record<string, unknown>): ReplaceArgs => {
  const old_string = read_text_arg(raw, "old_string");
  const new_string = read_text_arg(raw, "new_string");
  if (!old_string) {
    throw new ToolArgumentError("old_string must not be empty; use write_file to create or fill a file");
  }
  if (old_string === new_string) {
    throw new ToolArgumentError("old_string and new_string are identical, so the edit would change nothing");
  }
  return { path: require_string(raw, "path"), old_string, new_string, expected: read_int_arg(raw, "expected_replacements", 1, 10_000) ?? 1 };
};

export const replace_in_file_tool = define_tool<ReplaceArgs>({
  spec: {
    name: "replace_in_file",
    description:
      "Replace text in an existing file. old_string must reproduce the file's text: an exact match is tried first, then a match that ignores differences in whitespace, indentation and line endings, but every other character must match. The match must occur exactly expected_replacements times (default 1).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string", description: "Text copied from the file, with enough surrounding lines to be unique." },
        new_string: { type: "string" },
        expected_replacements: { type: "number", description: "How many occurrences to replace. Default 1." },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
  },
  profiles: write_profiles,
  parse: parse_replace,
  run: (ctx, args) =>
    guarded(ctx, "replace_in_file", async () => {
      const prepared = await prepare_replace(ctx.project_root, args.path, args.old_string, args.new_string, args.expected);
      const flexible = prepared.flexible ? ", matched with flexible whitespace" : "";
      const count = prepared.replaced === 1 ? "1 occurrence" : `${prepared.replaced} occurrences`;
      return apply_edit(ctx, prepared, `Replaced ${count} in ${prepared.target.relative}${flexible}`);
    }),
});
