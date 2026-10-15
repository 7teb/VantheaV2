import type { Search } from "./cmd-batch.ts";
import { walk_cmd, type Nested } from "./command-cmd.ts";
import { location_change, start_location, type Matcher } from "./command-location.ts";
import {
  assign_env, assign_joined, assign_variable, assignment_of, command_writes, concat, copy_values, create_values, expression_head, expression_value,
  poison_environment, poison_variables, read_variable, unresolved, type Assignment, type Value, type ValueState,
} from "./command-values.ts";
import {
  block_at, child_state, context, copy_state, drain, follows, group_at, invoked_block, join_states, keyword_of, keywords, line_at, lost_location, make_step, merged, payload_of,
  plain, program_name, record, redirect_free, same, script_like, step_word, values_at, type BlockPiece, type Context, type Effect, type GroupPiece, type Step, type Walk,
  type WalkState, type Write,
} from "./command-steps.ts";
import { shell_words } from "./shell-words.ts";
import { statement_parts, type Dialect, type StatementElement, type StatementPart } from "./statements.ts";

export { child_state, join_states, powershell_switch, powershell_takes_value, source_depth, type Effect, type Payload, type Step, type StepWord, type WalkState } from "./command-steps.ts";
export { concat, read_env, resolved, unresolved, type Value } from "./command-values.ts";
export { against_location, type Matcher } from "./command-location.ts";

export type WalkStart = { location: string; dialect: Dialect; env: Record<string, string | undefined>; script_path?: string; state?: WalkState; matches?: Matcher; depth?: number; line?: number };

const block_reason = "script block";

const unread_reason = "changed by a script the app did not read";

const later_writes = (ctx: Context, offset: number): Write[] => {
  if (ctx.logging) return [];
  if (!ctx.log.writes) {
    const writes: Write[] = [];
    drain(walk_text(ctx.root, 0, copy_state(ctx.initial), { ...ctx, fixed: null, fixed_line: null, logging: writes }, null));
    ctx.log.writes = writes;
  }
  const at = ctx.fixed ?? offset;
  return ctx.log.writes.filter((write) => write.offset > at);
};

export function* walk_command(text: string, start: WalkStart): Walk {
  const state = start.state
    ? { ...copy_state(start.state), values: { ...copy_values(start.state.values), script_path: start.script_path ?? "" } }
    : { values: create_values(start.env, start.script_path ?? ""), location: start_location(start.location), defined: new Set<string>(), joined: false };
  const ctx = context(text, start.dialect, start.script_path ?? "", start.script_path ?? "", start.depth ?? 0, start.matches, state, start.line ?? null);
  return yield* walk_text(text, 0, state, ctx, null);
}

function* walk_text(text: string, base: number, state: WalkState, ctx: Context, snapshot: ValueState | null): Walk {
  const parts = statement_parts(text, ctx.dialect);
  let current = state;
  let line = 0;
  let shot = snapshot ?? current.values;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as StatementPart;
    let last = part;
    for (let next = parts[index + 1]; ctx.dialect !== "cmd" && next && follows[keyword_of(last.text)]?.test(keyword_of(next.text)); next = parts[index + 1]) {
      index += 1;
      last = next;
    }
    if (ctx.dialect === "cmd" && !snapshot && part.line !== line) {
      line = part.line;
      shot = copy_values(current.values);
    }
    const elements = last === part ? part.elements : [{ text: text.slice(part.start, last.start + last.text.length), start: part.start }];
    const before = part.joiner ? copy_state(current) : null;
    current = yield* walk_statement(elements, base, current, ctx, shot);
    if (before) current = join_states(before, current);
  }
  return current;
}

function* walk_statement(elements: StatementElement[], base: number, state: WalkState, ctx: Context, snapshot: ValueState): Walk {
  let current = state;
  if (ctx.dialect === "cmd") {
    for (const element of elements) current = yield* walk_cmd(element.text, base + element.start, current, ctx, snapshot, nested);
    return current;
  }
  if (ctx.dialect === "posix") {
    for (const element of elements) {
      const prefix = /^(?:(?:if|then|else|elif|do|while|until|time|!)\s+|\w+=\S*\s+)*/.exec(element.text)?.[0] ?? "";
      const rest = element.text.slice(prefix.length);
      const group = /^\{\s([\s\S]*)\}$/.exec(rest);
      if (group) current = yield* walk_text(group[1] ?? "", base + element.start + prefix.length + 2, current, ctx, null);
      else if (rest && !/^(?:fi|done|esac|then|else|do|[{}])$/.test(rest)) [current] = yield* walk_element(rest, base + element.start + prefix.length, current, ctx, "pipe", null);
    }
    return current;
  }
  const first = elements[0] as StatementElement;
  const label = elements.length === 1 ? (/^:[A-Za-z_]\w*[ \t]+(?=[A-Za-z])/.exec(first.text)?.[0] ?? "") : "";
  const keyword = elements.length === 1 ? keyword_of(first.text.slice(label.length)) : "";
  if (keywords.has(keyword)) return yield* walk_keyword(keyword, first.text.slice(label.length), base + first.start + label.length, current, ctx);
  let input: Value | null = null;
  for (const [index, element] of elements.entries()) {
    const offset = base + element.start;
    const assignment = index === 0 && ctx.dialect === "powershell" ? assignment_of(element.text) : null;
    if (assignment) {
      current = yield* walk_assignment(assignment, element.text, offset, elements.length > 1, current, ctx);
      input = null;
      continue;
    }
    [current, input] = yield* walk_element(element.text, offset, current, ctx, index === 0 ? "head" : "pipe", input);
  }
  return current;
}

function* walk_assignment(assignment: Assignment, text: string, offset: number, piped: boolean, state: WalkState, ctx: Context): Walk {
  const rhs = assignment.rhs.trim();
  const rhs_offset = offset + assignment.rhs_start + assignment.rhs.length - assignment.rhs.trimStart().length;
  const words = shell_words(rhs, "powershell");
  const block = words.length === 1 ? block_at(words, 0) : null;
  const inner = rhs ? assignment_of(rhs) : null;
  let current = state;
  let value: Value = unresolved("expression not evaluated");
  if (block) {
    current = yield* walk_deferred(block.text, rhs_offset + block.start, current, ctx, "block", [], text);
    value = unresolved(block_reason);
  } else if (inner) {
    current = yield* walk_assignment(inner, rhs, rhs_offset, piped, current, ctx);
    if (inner.target !== "poison") value = read_variable(current.values, inner.names[0] ?? "", true);
  } else if (rhs) {
    [current] = yield* walk_element(rhs, rhs_offset, current, ctx, "head", null);
    const command = !expression_head(rhs) && !/^join-path(?=\s|$)/i.test(rhs);
    value = piped || command ? unresolved("assigned from command output") : expression_value(rhs, values_at(current), assignment.target === "env");
  }
  if (assignment.append) {
    const before = read_variable(values_at(current), assignment.names[0] ?? "", true);
    value = ("values" in before && before.list) || ("values" in value && value.list) ? unresolved("not a string") : concat([before, value]);
  }
  const string_cast = /^\[(?:system\.)?string\]$/i.test(assignment.cast);
  if (assignment.cast && (!string_cast || ("values" in value && value.list))) value = unresolved(string_cast ? "not a string" : "expression not evaluated");
  for (const name of assignment.names) {
    const env = /^env:/i.test(name);
    const bare = env ? name.slice(4) : name.replace(/^[^:]*:/, "");
    const written = assignment.target === "poison" ? unresolved("written by " + text.slice(0, 80)) : value;
    if (env) assign_env(current.values, bare, written);
    else assign_variable(current.values, bare, written);
    record(ctx, offset, env, bare, written);
  }
  return current;
}

function* walk_group(piece: GroupPiece, offset: number, state: WalkState, ctx: Context): Walk {
  if (ctx.dialect === "cmd") return state;
  if (piece.open !== "@{") return yield* walk_text(piece.text, offset + piece.start, state, ctx, null);
  let current = state;
  for (const part of statement_parts(piece.text)) {
    const key = /^(?:[\w.-]+|'[^']*'|"[^"]*")\s*=\s*/.exec(part.text)?.[0] ?? "";
    current = yield* walk_text(part.text.slice(key.length), offset + piece.start + part.start + key.length, current, ctx, null);
  }
  return current;
}

function* walk_element(text: string, offset: number, state: WalkState, ctx: Context, position: "head" | "pipe", input: Value | null): Generator<Step, [WalkState, Value | null], Effect | undefined> {
  const words = shell_words(text, ctx.dialect);
  let current = state;
  for (const word of words) {
    for (const piece of word.pieces) if (piece.kind === "group") current = yield* walk_group(piece, offset, current, ctx);
  }
  const command = position === "pipe" || ctx.dialect === "posix" || !expression_head(text);
  const call = command && (words[0]?.raw === "&" || words[0]?.raw === ".");
  const at = call ? 1 : 0;
  const target_block = call ? block_at(words, 1) : command && words.length === 1 ? invoked_block(words[0]) : null;
  if (target_block) {
    const exit = yield* walk_text(target_block.text, offset + target_block.start, copy_state(current), ctx, null);
    return [merged(current, exit, words[0]?.raw === "." ? "dot" : "call"), null];
  }
  const step_words = words.map((word) => step_word(word, current, ctx, current.values));
  const value = step_words[at]?.value ?? unresolved("no command");
  if (call && "unresolved" in value && value.unresolved === block_reason) {
    if (words[0]?.raw === ".") poison_variables(current.values, unread_reason);
    return [current, null];
  }
  const name = command ? plain(words[at]) : "";
  const exe = command ? program_name(value, name) : "";
  const found = command ? payload_of(exe, step_words, at, input, ctx) : null;
  const module = /^(?:import-module|ipmo)$/.test(name) || (name === "using" && /^module$/i.test(words[1]?.raw ?? ""));
  const iex = exe === "iex" || exe === "invoke-expression";
  const in_process = ctx.dialect === "powershell" && command && (module || (iex && !found?.walked) || ((call || /[\\/]|\.psm?1$/i.test(name)) && script_like(value)));
  const search: Search = command && !current.defined.has(name) && "values" in value && value.values.every((entry) => entry && !/[\\/]/.test(entry)) ? "path" : "none";
  const effect = yield make_step(text, step_words, current, ctx, offset, command, in_process, search, found, input);
  if (effect) current = merged(current, effect.state, call ? (words[0]?.raw === "." ? "dot" : "call") : module || iex ? "dot" : "call");
  else if (in_process && !ctx.silent) {
    poison_variables(current.values, unread_reason);
    poison_environment(current.values, unread_reason);
    lost_location(current, text);
  }
  const args = step_words.slice(at + 1);
  if (command) current.location = location_change(name, redirect_free(args), current.location, ctx.dialect, text, ctx.matches) ?? current.location;
  if (ctx.dialect === "powershell" && command_writes(name, args, text, current.values)) lost_location(current, text);
  if (/^(?:set-alias|sal|new-alias|nal)$/.test(name)) {
    const alias = args.find((arg) => !arg.word.raw.startsWith("-"))?.value;
    if (alias && "values" in alias) alias.values.forEach((entry) => current.defined.add(entry.toLowerCase()));
  }
  const in_place = /^(?:foreach-object|%|foreach|where-object|\?|where)$/.test(name);
  for (const word of command ? words.slice(at + 1) : words) {
    const block = block_at([word], 0);
    if (!block || (found?.walked && "values" in found.value && found.value.values.includes(block.text))) continue;
    current = in_place
      ? yield* walk_loop(block.text, offset + block.start, current, ctx, () => undefined, text)
      : yield* walk_deferred(block.text, offset + block.start, current, ctx, "block", [], text);
  }
  if (found?.walked && "values" in found.value) {
    const line = line_at(ctx, offset);
    const exits: WalkState[] = [];
    for (const body of found.value.values) {
      if (iex) exits.push(yield* walk_text(body, 0, copy_state(current), { ...ctx, depth: ctx.depth + 1, fixed: ctx.fixed ?? offset, fixed_line: line }, null));
      else yield* walk_command_child(body, found.dialect, current, ctx, line);
    }
    if (exits.length) current = exits.reduce(join_states);
  }
  return [current, !command && ctx.dialect === "powershell" ? expression_value(text, values_at(current)) : null];
}

function* walk_command_child(text: string, dialect: Dialect, state: WalkState, ctx: Context, line: number): Walk {
  const child = child_state(state);
  return yield* walk_text(text, 0, child, context(text, dialect, ctx.origin, "", ctx.depth + 1, ctx.matches, child, line), null);
}

const nested: Nested = { text: walk_text, child: walk_command_child };

function* walk_loop(text: string, offset: number, state: WalkState, ctx: Context, bind: (state: WalkState) => void, statement: string): Walk {
  const enter = (from: WalkState) => {
    const entry = copy_state(from);
    bind(entry);
    return entry;
  };
  const quiet = { ...ctx, silent: true };
  const widened = join_states(state, drain(walk_text(text, offset, enter(state), quiet, null)));
  const settled = join_states(widened, drain(walk_text(text, offset, enter(widened), quiet, null)));
  unsettle(settled, widened, settled, statement);
  const exit = yield* walk_text(text, offset, enter(settled), ctx, null);
  const result = join_states(state, exit);
  unsettle(join_states(settled, exit), settled, result, statement);
  return result;
}

const unsettle = (after: WalkState, before: WalkState, target: WalkState, statement: string) => {
  for (const [key, value] of after.values.vars) if (!same(value, before.values.vars.get(key))) target.values.vars.set(key, unresolved("changes on every loop iteration"));
  for (const [key, value] of after.values.env) if (!same(value, before.values.env.get(key))) target.values.env.set(key, unresolved("changes on every loop iteration"));
  if (!same(after.location.current, before.location.current)) lost_location(target, statement);
};

function* walk_deferred(text: string, offset: number, state: WalkState, ctx: Context, scope: "function" | "block", params: string[], statement: string): Walk {
  const start = copy_state(state);
  for (const write of later_writes(ctx, offset)) assign_joined(start.values, write.name, write.value, write.env);
  for (const name of params) assign_variable(start.values, name, unresolved("function parameter"));
  const exit = yield* walk_text(text, offset, copy_state(start), ctx, null);
  if (!same(exit.location.current, start.location.current)) lost_location(state, statement);
  for (const [key, value] of exit.values.env) if (!same(value, start.values.env.get(key))) assign_env(state.values, key, unresolved("changed in a function or script block"));
  if (exit.values.env_reason !== start.values.env_reason) poison_environment(state.values, exit.values.env_reason);
  if (scope === "function") return state;
  for (const [key, value] of exit.values.vars) if (!same(value, start.values.vars.get(key))) assign_variable(state.values, key, unresolved("changed in a script block"));
  if (exit.values.vars_reason !== start.values.vars_reason) poison_variables(state.values, exit.values.vars_reason);
  return state;
}

function* walk_keyword(keyword: string, text: string, offset: number, state: WalkState, ctx: Context): Walk {
  const words = shell_words(text, "powershell");
  let current = state;
  if (keyword === "break" || keyword === "continue") return current;
  if (keyword === "return" || keyword === "throw" || keyword === "exit") {
    const rest = text.slice(keyword.length);
    return yield* walk_text(rest.trim(), offset + keyword.length + rest.length - rest.trimStart().length, current, ctx, null);
  }
  if (keyword === "if") {
    const exits: WalkState[] = [];
    let closed = false;
    for (let index = 0; index < words.length; index += 1) {
      const word = plain(words[index]);
      const conditional = word === "if" || word === "elseif";
      if (!conditional && word !== "else") continue;
      const condition = conditional ? group_at(words, index + 1) : null;
      if (condition) current = yield* walk_group(condition, offset, current, ctx);
      const body = block_at(words, index + (conditional ? 2 : 1));
      if (body) exits.push(yield* walk_text(body.text, offset + body.start, copy_state(current), ctx, null));
      closed ||= word === "else";
      index += conditional ? 2 : 1;
    }
    const all = closed ? exits : [current, ...exits];
    return all.length ? all.reduce(join_states) : current;
  }
  if (keyword === "foreach" && group_at(words, 1) && block_at(words, 2)) {
    const header = group_at(words, 1) as GroupPiece;
    const body = block_at(words, 2) as BlockPiece;
    const match = /^(\s*\$([\w:]+)\s+in\s+)([\s\S]*)$/i.exec(header.text);
    if (match) {
      const source = (match[3] ?? "").trim();
      const source_offset = offset + header.start + (match[1] ?? "").length;
      let list: Value = unresolved("assigned from command output");
      const parts = statement_parts(source);
      if (parts.length === 1 && parts[0]?.elements.length === 1) {
        let found: Value | null;
        [current, found] = yield* walk_element(source, source_offset, current, ctx, "head", null);
        if (found) list = found;
      } else current = yield* walk_text(source, source_offset, current, ctx, null);
      const item: Value = "values" in list ? { values: list.values, maybe_unset: !list.values.length } : list;
      const name = (match[2] ?? "").replace(/^[^:]*:/, "");
      record(ctx, offset, false, name, item);
      return yield* walk_loop(body.text, offset + body.start, current, ctx, (entry) => assign_variable(entry.values, name, item), text);
    }
  }
  if (keyword === "switch") {
    const body = block_at(words, words.findLastIndex((word) => block_at([word], 0)));
    for (const word of words) {
      const group = group_at([word], 0);
      if (group) current = yield* walk_group(group, offset, current, ctx);
    }
    for (const clause of body ? statement_parts(body.text) : []) {
      for (const word of shell_words(clause.text, "powershell")) {
        const group = group_at([word], 0);
        const block = block_at([word], 0);
        const clause_offset = offset + (body?.start ?? 0) + clause.start;
        if (group) current = yield* walk_group(group, clause_offset, current, ctx);
        if (block) current = join_states(current, yield* walk_text(block.text, clause_offset + block.start, copy_state(current), ctx, null));
      }
    }
    return current;
  }
  if (keyword === "try") {
    for (let index = 0; index < words.length; index += 1) {
      const word = plain(words[index]);
      if (word !== "try" && word !== "catch" && word !== "finally") continue;
      let at = index + 1;
      while (at < words.length && !block_at(words, at)) at += 1;
      const body = block_at(words, at);
      if (!body) break;
      if (word === "finally") current = yield* walk_text(body.text, offset + body.start, current, ctx, null);
      else current = join_states(current, yield* walk_text(body.text, offset + body.start, copy_state(current), ctx, null));
      index = at;
    }
    return current;
  }
  if (keyword === "function" || keyword === "filter" || keyword === "workflow" || keyword === "configuration") {
    const name = plain(words[1]).replace(/^(?:global|script|local|private):/, "");
    if (name) current.defined.add(name);
    const params = [...(group_at(words, 2)?.text ?? "").matchAll(/\$([\w]+)/g)].map((match) => match[1] ?? "");
    const body = block_at(words, words.findLastIndex((word) => block_at([word], 0)));
    return body ? yield* walk_deferred(body.text, offset + body.start, current, ctx, "function", params, text) : current;
  }
  if (keyword === "param") {
    const group = group_at(words, 1);
    if (!group) return current;
    current = yield* walk_group(group, offset, current, ctx);
    for (const match of group.text.matchAll(/\$([\w]+)/g)) assign_variable(current.values, match[1] ?? "", unresolved("function parameter"));
    const rest = words[2];
    return rest ? yield* walk_text(text.slice(rest.start), offset + rest.start, current, ctx, null) : current;
  }
  const loop = /^(?:for|while|do|foreach)$/.test(keyword);
  const in_place = /^(?:begin|process|end|clean|dynamicparam|else|elseif|catch|finally|until)$/.test(keyword);
  for (const word of words) {
    const group = group_at([word], 0);
    const block = block_at([word], 0);
    if (group) current = yield* walk_group(group, offset, current, ctx);
    if (group && keyword === "for") {
      for (const match of group.text.matchAll(/\$([\w:]+)\s*(?:[-+*/%]?=|\+\+|--)/g)) assign_variable(current.values, (match[1] ?? "").replace(/^[^:]*:/, ""), unresolved("loop variable"));
    }
    if (!block) continue;
    if (loop) current = yield* walk_loop(block.text, offset + block.start, current, ctx, () => undefined, text);
    else if (in_place) current = yield* walk_text(block.text, offset + block.start, current, ctx, null);
    else current = yield* walk_deferred(block.text, offset + block.start, current, ctx, "block", [], text);
  }
  return current;
}
