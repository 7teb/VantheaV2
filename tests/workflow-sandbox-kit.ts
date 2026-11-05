import { read_script, wrap_body } from "../electron/workflows/meta.ts";
import type { HookCall } from "../electron/workflows/protocol.ts";
import { open_sandbox, type Sandbox } from "../electron/workflows/sandbox.ts";

export type AgentItem = Extract<HookCall, { kind: "agent" }>;

export type ChildItem = Extract<HookCall, { kind: "workflow" }>;

export type Reply = { ok: true; value: unknown } | { ok: false; text: string } | null;

export type Host = {
  agent?: (item: AgentItem, sandbox: Sandbox) => Reply | Promise<Reply>;
  child?: (item: ChildItem) => { source: string; name: string } | { error: string };
};

export type Ended = { kind: "done"; value: unknown } | { kind: "failed"; message: string } | { kind: "compile"; message: string } | { kind: "broken"; message: string };

export type Outcome = { ended: Ended; items: HookCall[]; batches: number };

export const meta_head = "export const meta = { name: 'test', description: 'a test workflow' }\n";

export const run_script = (body: string, args: unknown = undefined, host: Host = {}): Promise<Outcome> =>
  new Promise((resolve) => {
    const items: HookCall[] = [];
    let batches = 0;
    let finished = false;
    const finish = (ended: Ended) => {
      if (finished) {
        return;
      }
      finished = true;
      void sandbox.terminate().then(() => resolve({ ended, items, batches }));
    };
    const answer = async (item: AgentItem) => {
      const reply = host.agent ? await host.agent(item, sandbox) : { ok: true as const, value: `result of ${item.prompt}` };
      if (reply === null) {
        return;
      }
      if (reply.ok) {
        sandbox.settle(item.id, true, JSON.stringify(reply.value ?? null));
      } else {
        sandbox.settle(item.id, false, reply.text);
      }
    };
    const read = read_script(`${meta_head}${body}`);
    const sandbox = open_sandbox(
      { source: wrap_body(read.body), filename: "workflow.js", args_text: args === undefined ? "" : JSON.stringify(args) },
      {
        batch: (batch) => {
          batches += 1;
          for (const item of batch) {
            items.push(item);
            if (item.kind === "agent") {
              void answer(item);
            } else if (item.kind === "workflow") {
              const child = host.child?.(item) ?? { error: "no child workflows in this test" };
              if ("error" in child) {
                sandbox.settle(item.id, false, child.error);
              } else {
                const child_read = read_script(child.source);
                sandbox.child(item.id, wrap_body(child_read.body), `${child.name}.js`, child.name, item.has_args ? JSON.stringify(item.args) : "");
              }
            } else if (item.kind === "done") {
              finish({ kind: "done", value: JSON.parse(item.value_json) });
            } else if (item.kind === "failed") {
              finish({ kind: "failed", message: item.message });
            }
          }
        },
        broken: (message) => finish({ kind: "broken", message }),
      },
    );
    void sandbox.compiled.then((compiled) => {
      if (!compiled.ok) {
        finish({ kind: "compile", message: compiled.message });
      }
    });
  });

export const done_value = (outcome: Outcome): unknown => {
  if (outcome.ended.kind !== "done") {
    throw new Error(`the script did not finish: ${JSON.stringify(outcome.ended)}`);
  }
  return outcome.ended.value;
};

export const agent_items = (outcome: Outcome): AgentItem[] => outcome.items.filter((item): item is AgentItem => item.kind === "agent");
