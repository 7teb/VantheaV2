import type { HookRun } from "../../shared/hook-notes.ts";
import { hook_applies, type Hook, type HookEvent } from "../../shared/hooks.ts";
import { invalidate_index } from "../project/index.ts";
import type { HookIdentity } from "./input.ts";
import { interpret } from "./output.ts";
import { run_hook } from "./run.ts";
import { chat_hooks } from "./store.ts";

export type HookText = { hook: Hook; text: string };

export type FireResult = { aborted: true } | { aborted: false; blocks: HookText[]; contexts: HookText[]; runs: HookRun[] };

const nothing: FireResult = { aborted: false, blocks: [], contexts: [], runs: [] };

const selected = (hooks: Hook[], event: HookEvent, target: string | null): Hook[] => {
  const seen = new Set<string>();
  return hooks.filter((hook) => {
    const key = `${hook.shell}\n${hook.command}`;
    if (!hook_applies(hook, event, target) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const fire_hooks = async (identity: HookIdentity, event: HookEvent, target: string | null, input: Record<string, unknown>): Promise<FireResult> => {
  const hooks = selected(chat_hooks(identity.project_path), event, target);
  if (!hooks.length) {
    return nothing;
  }
  const exits = await Promise.all(hooks.map((hook) => run_hook(hook, input, identity.cwd, identity.signal)));
  invalidate_index(identity.cwd);
  const blocks: HookText[] = [];
  const contexts: HookText[] = [];
  const runs: HookRun[] = [];
  for (const [at, exit] of exits.entries()) {
    if (exit.kind === "aborted") {
      return { aborted: true };
    }
    const hook = hooks[at]!;
    const effect = interpret(hook, exit);
    if (effect.block) {
      blocks.push({ hook, text: effect.block.reason });
    }
    if (effect.context !== null) {
      contexts.push({ hook, text: effect.context });
    }
    if (effect.run) {
      runs.push(effect.run);
    }
  }
  return identity.signal.aborted ? { aborted: true } : { aborted: false, blocks, contexts, runs };
};
