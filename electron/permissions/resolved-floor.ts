import path from "node:path";
import { walk_command, type Step, type StepWord, type Value } from "./command-walk.ts";
import { binding_writes, definite, expression_value, group_items, module_prefix, unqualified } from "./command-values.ts";
import { source_depth, values_at } from "./command-steps.ts";
import { delete_names, dotnet_delete, type FloorScope } from "./floor-shared.ts";
import { flag_name } from "./powershell-move.ts";
import { shell_words, type Piece, type Word } from "./shell-words.ts";
import type { Dialect } from "./statements.ts";

export type FloorAnalysis = { reason: string; uncertain: boolean };

type FloorCheck = (command: string, scope: FloorScope) => string;

type Scan = FloorAnalysis & { bindings: boolean; opaque: boolean; input_dependent: boolean };

type Pass = { scope: FloorScope; check: FloorCheck; scan: Scan; depth: number };

type DeleteTarget = { value: Value; literal: boolean; dependent: boolean };

type TargetCheck = (value: string, cwd: string, literal: boolean) => string;

const deletion = new RegExp(`^(?:${delete_names})$`, "i");

const invoke_command = /^\$(?:executioncontext|\{executioncontext\})\.invokecommand$/i;

const named_invoke = /^(.*)\.(?:invokescript|(['"])invokescript\2)$/i;

const delete_switches = ["recurse", "force", "whatif", "confirm", "verbose", "debug"];

const delete_values = [
  "path",
  "literalpath",
  "filter",
  "include",
  "exclude",
  "credential",
  "erroraction",
  "warningaction",
  "informationaction",
  "errorvariable",
  "warningvariable",
  "informationvariable",
  "outvariable",
  "outbuffer",
  "pipelinevariable",
];

const delete_parameters = [...delete_switches, ...delete_values];

const parameter_aliases = new Map([
  ["lp", "literalpath"],
  ["pspath", "literalpath"],
  ["ea", "erroraction"],
  ["wa", "warningaction"],
  ["infa", "informationaction"],
  ["ev", "errorvariable"],
  ["wv", "warningvariable"],
  ["iv", "informationvariable"],
  ["ov", "outvariable"],
  ["ob", "outbuffer"],
  ["pv", "pipelinevariable"],
  ["vb", "verbose"],
  ["db", "debug"],
  ["wi", "whatif"],
  ["cf", "confirm"],
]);

const single_quoted = (text: string): string => "'" + text.replaceAll("'", "''") + "'";

const literal_text = (value: string): string => (/^[\w./:\\=-]+$/.test(value) ? value : single_quoted(value));

const location_of = (step: Step): string => (definite(step.location) ? (step.location.values[0] ?? "") : "");

const expands = (piece: Piece): boolean =>
  piece.kind === "text" && piece.quote !== "single" && piece.quote !== "single_here" && /[$`]/.test(piece.text);

const redefines = (step: Step, names: string[]): boolean => names.some((name) => step.state.defined.has(name.toLowerCase()));

const dependencies = (words: Word[]): boolean => {
  const pieces = words.flatMap((word) => word.pieces);
  while (pieces.length) {
    const piece = pieces.pop();
    if (!piece) break;
    if (piece.kind === "group") {
      pieces.push(...shell_words(piece.text, "powershell", "expression").flatMap((word) => word.pieces));
      continue;
    }
    if (piece.kind !== "text" || expands(piece)) return true;
  }
  return false;
};

const parameter_of = (flag: string): string => {
  const alias = parameter_aliases.get(flag);
  if (alias) return alias;
  if (delete_parameters.includes(flag)) return flag;
  const matches = delete_parameters.filter((name) => name.startsWith(flag));
  return matches.length === 1 ? (matches[0] ?? "") : "";
};

const delete_targets = (args: StepWord[]): { targets: DeleteTarget[]; uncertain: boolean } => {
  const targets: DeleteTarget[] = [];
  let uncertain = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as StepWord;
    if (arg.word.op) {
      if (arg.word.op !== ",") index += 1;
      continue;
    }
    const flag = flag_name(arg.word);
    if (!flag) {
      targets.push({ value: arg.value, literal: false, dependent: dependencies([arg.word]) });
      continue;
    }
    const name = parameter_of(flag);
    if (delete_switches.includes(name)) {
      if (arg.word.raw.endsWith(":")) index += 1;
      continue;
    }
    if (!delete_values.includes(name)) {
      uncertain = true;
      continue;
    }
    index += 1;
    const value = args[index];
    if (!value) {
      uncertain = true;
      continue;
    }
    if (name === "path" || name === "literalpath") {
      targets.push({ value: value.value, literal: name === "literalpath", dependent: dependencies([value.word]) });
    }
  }
  return { targets, uncertain };
};

const resolvable = (value: string, target: DeleteTarget, opaque: boolean, cwd: string): boolean => {
  const absolute = path.win32.isAbsolute(value);
  if (opaque && (target.dependent || !absolute)) return false;
  return absolute || Boolean(cwd);
};

const target_floor = (step: Step, targets: DeleteTarget[], opaque: boolean, check: TargetCheck): FloorAnalysis => {
  const result: FloorAnalysis = { reason: "", uncertain: !targets.length };
  const cwd = location_of(step);
  for (const target of targets) {
    if (!("values" in target.value)) {
      result.uncertain = true;
      continue;
    }
    result.uncertain ||= target.value.maybe_unset;
    for (const value of target.value.values) {
      if (!resolvable(value, target, opaque, cwd)) {
        result.uncertain = true;
        continue;
      }
      result.reason ||= check(value, cwd, target.literal);
    }
  }
  return result;
};

const assignment_text = (prefix: string, name: string, value: Value): string =>
  /^[a-z_]\w*$/i.test(name) && definite(value) ? `${prefix}${name}=${single_quoted(value.values[0] ?? "")};` : "";

const assignments = (step: Step): string =>
  [
    ...[...step.state.values.vars].map(([name, value]) => assignment_text("$", name, value)),
    ...[...step.state.values.env].map(([name, value]) => assignment_text("$env:", name, value)),
  ].join("");

const dotnet_delete_step = (step: Step, pass: Pass) => {
  const { scan } = pass;
  const receiver = step.words[0]?.word.raw ?? "";
  const method = step.words[1]?.word.pieces[0];
  if (!dotnet_delete.test(receiver + "(") || method?.kind !== "group" || method.open !== "(") return;
  const value = group_items(method.text, values_at(step.state))[0];
  const words = shell_words(method.text, "powershell", "expression");
  const comma = words.findIndex((word) => word.op === ",");
  const first_argument = comma < 0 ? words : words.slice(0, comma);
  const targets = value ? [{ value, literal: true, dependent: dependencies(first_argument) }] : [];
  const check: TargetCheck = (target, cwd) => pass.check(`${receiver}(${literal_text(target)})`, { ...pass.scope, cwd });
  const found = target_floor(step, targets, scan.opaque, check);
  scan.reason ||= found.reason;
  scan.uncertain ||= found.uncertain;
};

const invokes_script = (selected: Value | null, member: Piece | undefined, receiver: string): boolean => {
  if (selected && definite(selected)) return selected.values[0]?.toLowerCase() === "invokescript";
  return Boolean(member) && invoke_command.test(receiver.slice(0, -1));
};

const invoke_script_step = (step: Step, pass: Pass) => {
  const { scan } = pass;
  const receiver = step.words[0]?.word.raw ?? "";
  const named = named_invoke.exec(receiver);
  const member = receiver.endsWith(".") ? step.words[1]?.word.pieces[0] : undefined;
  const selected = member?.kind === "group" && member.open === "(" ? expression_value(member.text, values_at(step.state)) : null;
  const group = step.words[named ? 1 : 2]?.word.pieces[0];
  if (!(named || invokes_script(selected, member, receiver)) || group?.kind !== "group" || group.open !== "(") return;
  scan.opaque = true;
  const items = group_items(group.text, values_at(step.state));
  const script = items.length === 1 ? items[0] : null;
  const owner = named?.[1] ?? receiver.slice(0, -1);
  if (!invoke_command.test(owner) || (selected && !definite(selected)) || !script || !definite(script) || pass.depth >= source_depth) {
    scan.uncertain = true;
    return;
  }
  const text = assignments(step) + (script.values[0] ?? "");
  const location = { ...pass.scope, cwd: location_of(step) };
  const direct = pass.check(text, location);
  const nested = direct ? { reason: direct, uncertain: false } : resolved_floor(text, location, "powershell", pass.check, pass.depth + 1);
  scan.reason ||= nested.reason;
  scan.uncertain ||= nested.uncertain || !definite(step.location);
};

const expression_step = (step: Step, pass: Pass) => {
  const { scan } = pass;
  dotnet_delete_step(step, pass);
  invoke_script_step(step, pass);
  const first = step.words[0]?.word.pieces[0];
  const method_call = first?.kind === "text" && first.quote === "none" && /::|\.\w+\s*\(/.test(step.text);
  if (method_call && !definite(expression_value(step.text, values_at(step.state)))) scan.opaque = true;
  if (step.depth > 0 && step.words.some((arg) => !definite(arg.value))) scan.uncertain = true;
  scan.input_dependent = dependencies(step.words.map((arg) => arg.word));
};

const delete_statement = (name: string, value: string, literal: boolean): string => name + (literal ? " -LiteralPath " : " ") + literal_text(value);

const deletion_step = (step: Step, head: StepWord, args: StepWord[], deleting: string[], computed: boolean, pass: Pass) => {
  const { scan } = pass;
  const parsed = delete_targets(args);
  if (!parsed.targets.length && step.input) {
    parsed.targets.push({ value: step.input, literal: false, dependent: scan.input_dependent });
  }
  if (!definite(head.value) || redefines(step, head.value.values) || ((scan.bindings || scan.opaque) && computed)) scan.uncertain = true;
  for (const name of deleting) {
    const check: TargetCheck = (value, cwd, literal) => pass.check(delete_statement(name, value, literal), { ...pass.scope, cwd });
    const found = target_floor(step, parsed.targets, scan.opaque, check);
    scan.reason ||= found.reason;
    scan.uncertain ||= found.uncertain || parsed.uncertain;
  }
};

const resolved_argument = (arg: StepWord): string | null => {
  if (arg.word.op) return arg.word.raw;
  if ("values" in arg.value && !arg.value.maybe_unset && arg.value.values.length) return arg.value.values.map(literal_text).join(" ");
  return null;
};

const invocation_step = (step: Step, head: StepWord, args: StepWord[], call: boolean, dynamic: boolean, pass: Pass) => {
  const { scan } = pass;
  if (step.payload && (!step.payload.walked || !definite(step.payload.value))) scan.uncertain = true;
  const qualified = "values" in head.value && head.value.values.some((value) => module_prefix.test(value));
  if (!call && !dynamic && !qualified && step.depth === 0 && !step.payload) return;
  if (scan.bindings || scan.opaque) scan.uncertain = true;
  if (!definite(head.value)) scan.uncertain = true;
  if (!("values" in head.value)) return;
  if (redefines(step, head.value.values)) scan.uncertain = true;
  const cwd = location_of(step);
  if (!definite(step.location)) scan.uncertain = true;
  if (step.payload?.dialect === "powershell" && "values" in step.payload.value) {
    for (const text of step.payload.value.values) {
      scan.reason ||= pass.check(assignments(step) + text, { ...pass.scope, cwd });
    }
  }
  const resolved = args.map(resolved_argument);
  if (dynamic && resolved.includes(null)) scan.uncertain = true;
  const argument_text = args.map((arg, index) => resolved[index] ?? arg.word.raw).join(" ");
  for (const value of head.value.values) {
    const name = literal_text(unqualified(value));
    const call_name = name.startsWith("'") ? `& ${name}` : name;
    const statement = argument_text ? `${call_name} ${argument_text}` : call_name;
    scan.reason ||= pass.check(statement, { ...pass.scope, cwd });
  }
};

const command_step = (step: Step, pass: Pass) => {
  const call = step.words[0]?.word.raw === "&" || step.words[0]?.word.raw === ".";
  const at = call ? 1 : 0;
  const head = step.words[at];
  if (!head) return;
  const args = step.words.slice(at + 1);
  const names = "values" in head.value ? head.value.values.map(unqualified) : [];
  if (names.some((name) => binding_writes(name, args))) pass.scan.bindings = true;
  const dynamic = head.word.pieces.some((piece) => piece.kind !== "text" || expands(piece));
  const deleting = names.filter((name) => deletion.test(name));
  if (deleting.length) {
    deletion_step(step, head, args, deleting, call || dynamic, pass);
    return;
  }
  invocation_step(step, head, args, call, dynamic, pass);
};

export const resolved_floor = (command: string, scope: FloorScope, dialect: Dialect, check: FloorCheck, depth = 0): FloorAnalysis => {
  const scan: Scan = { reason: "", uncertain: false, bindings: false, opaque: false, input_dependent: false };
  const pass: Pass = { scope, check, scan, depth };
  for (const step of walk_command(command, { dialect, location: scope.cwd ?? "", env: process.env })) {
    if (step.dialect !== "powershell") continue;
    if (step.command) {
      command_step(step, pass);
    } else {
      expression_step(step, pass);
    }
  }
  return { reason: scan.reason, uncertain: scan.uncertain };
};
