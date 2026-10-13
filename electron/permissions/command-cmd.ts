import { cmd_condition_body, cmd_internal, cmd_loop_body, cmd_name, cmd_search, cmd_set, percent_expand } from "./cmd-batch.ts";
import { location_change } from "./command-location.ts";
import { assign_env, assign_joined, poison_environment, resolved, unresolved, type ValueState } from "./command-values.ts";
import { copy_state, join_states, line_at, make_step, payload_of, program_name, record, redirect_free, step_word, type Context, type Walk, type WalkState } from "./command-steps.ts";
import { shell_words } from "./shell-words.ts";
import type { Dialect } from "./statements.ts";

export type Nested = {
  text: (text: string, base: number, state: WalkState, ctx: Context, snapshot: ValueState | null) => Walk;
  child: (text: string, dialect: Dialect, state: WalkState, ctx: Context, line: number) => Walk;
};

function* walk_joined(text: string, offset: number, state: WalkState, ctx: Context, snapshot: ValueState, nested: Nested): Walk {
  const exit = yield* nested.text(text, offset, copy_state(state), ctx, snapshot);
  return join_states(state, exit);
}

export function* walk_cmd(text: string, offset: number, state: WalkState, ctx: Context, snapshot: ValueState, nested: Nested): Walk {
  const words = shell_words(text, "cmd");
  const first = words[0];
  if (!first) return state;
  const head = first.pieces[0];
  const name = cmd_name(first);
  if (head?.kind === "group") {
    state.joined = true;
    const current = yield* walk_joined(head.text, offset + head.start, state, ctx, snapshot, nested);
    const other = /^else$/i.test(words[1]?.raw ?? "") ? words[2] : undefined;
    return other ? yield* walk_joined(text.slice(other.start), offset + other.start, current, ctx, snapshot, nested) : current;
  }
  if (name === "if" || name === "for") {
    state.joined = true;
    const at = name === "for" ? cmd_loop_body(words) : -1;
    const body = name === "if" ? cmd_condition_body(words) : at > 0 ? (words[at]?.start ?? -1) : -1;
    let current = state;
    for (const word of name === "for" ? words.slice(1, at) : []) {
      const listed = word.pieces[0]?.kind === "group" ? /^\s*(['`])([\s\S]*)['`]\s*$/.exec(word.pieces[0].text) : null;
      if (listed) current = yield* walk_joined(listed[2] ?? "", offset + word.start + 2, current, ctx, snapshot, nested);
    }
    const letter = name === "for" ? (words.slice(1, at).map((word) => /^%%?([A-Za-z])$/.exec(word.raw)?.[1]).find(Boolean) ?? "") : "";
    return body >= 0 ? yield* walk_joined(text.slice(body), offset + body, current, { ...ctx, loop_vars: ctx.loop_vars + letter }, snapshot, nested) : current;
  }
  if (name.startsWith(":") || name === "goto" || (name === "call" && cmd_name(words[1]).startsWith(":"))) {
    state.joined = true;
    return state;
  }
  const set = name === "set" ? cmd_set(text) : null;
  if (set) {
    const value = "value" in set ? (set.value ? percent_expand(set.value, snapshot, ctx.script_path, ctx.loop_vars) : resolved([])) : unresolved(set.poison);
    if (!set.name) poison_environment(state.values, "set by arithmetic or input");
    else if (state.joined) assign_joined(state.values, set.name, value, true);
    else assign_env(state.values, set.name, value);
    record(ctx, offset, true, set.name, value);
    return state;
  }
  const step_words = words.map((word) => step_word(word, state, ctx, snapshot));
  const lead = step_words[0];
  if (lead && first.raw.startsWith("@") && "values" in lead.value) step_words[0] = { ...lead, value: resolved(lead.value.values.map((entry) => entry.replace(/^@+/, ""))) };
  const at = name === "call" ? 1 : 0;
  const target = cmd_name(words[at]);
  const command = !cmd_internal(name) || name === "call" || name === "start";
  const found = command ? payload_of(program_name(step_words[at]?.value ?? unresolved("no command"), target), step_words, at, null, ctx) : null;
  yield make_step(text, step_words, state, ctx, offset, command, false, command ? cmd_search(target) : "none", found);
  state.location = location_change(name, redirect_free(step_words.slice(1)), state.location, "cmd", text, ctx.matches) ?? state.location;
  if (found?.walked && "values" in found.value) {
    for (const body of found.value.values) yield* nested.child(body, found.dialect, state, ctx, line_at(ctx, offset));
  }
  return state;
}
