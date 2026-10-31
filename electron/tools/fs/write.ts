import type { ToolView } from "../../../shared/tool-view.ts";
import { effective_mode } from "../../permissions/full-window.ts";
import { is_instruction_file } from "../../permissions/instruction-files.ts";
import { actor_label } from "../../permissions/script-retention.ts";
import { stat_optional } from "../../permissions/source-read.ts";
import { record_write } from "../../permissions/written-files.ts";
import { commit_edit, prepare_replace, prepare_write, type PreparedEdit } from "../../project/edit.ts";
import { read_refusal, record_read } from "../../project/read-ledger.ts";
import { turn_diffs } from "../../turn-diff/index.ts";
import { require_string } from "../browser/common.ts";
import { define_tool, ToolArgumentError, type ToolContext, type ToolProfile, type ToolResult } from "../types.ts";
import { denied, failed, guarded, read_int_arg, read_text_arg } from "./common.ts";
import { style_check } from "./style-check.ts";

const write_profiles: ToolProfile[] = ["main", "worker"];

const edit_view = (prepared: PreparedEdit): ToolView => ({
  kind: "edit",
  path: prepared.target.relative,
  created: prepared.previous === null,
  added: prepared.diff.added,
  removed: prepared.diff.removed,
  diff: prepared.diff.lines,
});

const apply_edit = async (ctx: ToolContext, tool: string, prepared: PreparedEdit, summary: string): Promise<ToolResult> => {
  const refusal = await read_refusal(ctx.chat_id, ctx.review.actor.id, prepared.target.target, prepared.target.relative, prepared.previous_sha256);
  if (refusal) {
    return failed(refusal);
  }
  const view = edit_view(prepared);
  const mode = effective_mode(ctx.chat_id, ctx.mode);
  const instruction_file = mode === "auto" && is_instruction_file(prepared.target.relative);
  if (mode === "ask" || instruction_file) {
    const decision = await ctx.approve({
      kind: "write",
      path: prepared.target.relative,
      created: prepared.previous === null,
      added: prepared.diff.added,
      removed: prepared.diff.removed,
      diff: prepared.diff.lines,
      ...(instruction_file ? { instruction_file: true } : {}),
    });
    if (!decision.approved) {
      return denied(`the edit to ${prepared.target.relative}`, decision);
    }
  }
  const prior = await stat_optional(prepared.target.target, "the write ledger");
  await turn_diffs.before_write(ctx.chat_id, prepared.target.target);
  const sha256 = await commit_edit(prepared);
  await record_read(ctx.chat_id, ctx.review.actor.id, prepared.target.target, sha256);
  record_write(ctx.chat_id, prepared.target.target, { actor: actor_label(ctx.review.actor), tool, call_id: ctx.call_id, at: Date.now(), sha256, prior_birthtime: prior?.birthtimeMs ?? null });
  return { status: "done", text: `${summary} (+${prepared.diff.added} -${prepared.diff.removed} lines)`, view };
};

export const write_file_tool = define_tool<{ path: string; content: string }>({
  spec: {
    name: "write_file",
    description: "Create a file or overwrite it with the given text. A new file is written as UTF-8; an existing file keeps its encoding (UTF-8, UTF-16 or Windows-1252). path is project-relative; missing folders are created. To overwrite an existing file you must have read it with read_file, and it must not have changed on disk since your last read or write of it; otherwise the call fails and nothing is written. Prefer replace_in_file for small changes to an existing file.",
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
      if (prepared.previous === args.content && prepared.previous_sha256 !== null) {
        await record_read(ctx.chat_id, ctx.review.actor.id, prepared.target.target, prepared.previous_sha256);
        return { status: "done", text: `${prepared.target.relative} already has exactly this content; nothing was written.`, view: edit_view(prepared) };
      }
      const verb = prepared.previous === null ? "Created" : "Overwrote";
      const result = await apply_edit(ctx, "write_file", prepared, `${verb} ${prepared.target.relative} (${Buffer.byteLength(args.content, "utf8")} bytes)`);
      if (result.status !== "done") {
        return result;
      }
      const note = await style_check(ctx, prepared.target.relative, prepared.previous, args.content);
      return note ? { ...result, text: `${result.text}\n\n${note}` } : result;
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
      "Replace text in an existing file. old_string must reproduce the file's text: an exact match is tried first, then a match that ignores differences in whitespace, indentation and line endings, but every other character must match. The match must occur exactly expected_replacements times (default 1). You must have read the file with read_file, and it must not have changed on disk since your last read or write of it; otherwise the call fails and nothing is written.",
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
      return apply_edit(ctx, "replace_in_file", prepared, `Replaced ${count} in ${prepared.target.relative}${flexible}`);
    }),
});
