import { build, type Plugin } from "esbuild";
import type { PermissionMode } from "../shared/chat.ts";

export type RecordedReview = { input: { action: { gaps: string[] } } };

export type Policy = typeof import("../electron/permissions/decide.ts");

const store = globalThis as typeof globalThis & { policy_reviews?: RecordedReview[] };

export const policy_reviews = (): RecordedReview[] => {
  store.policy_reviews ??= [];
  return store.policy_reviews;
};

const sources_stub = 'export const inspect_command_sources = async () => ({ pins: [], hash: "fixture", files: [], gaps: [], catastrophic: [], programs: [], notes: [] });';

const bash_stub = "export const bash_env = (env) => env;";

const review_stub = [
  "export const review_verdict = async (request) => {",
  "  (globalThis.policy_reviews ??= []).push(request);",
  '  const record = { id: "review", at: 0, actor: request.reviewer.actor, tool: "", subject: "", cwd: "", verdict: "allow", source: "model", reason: "", rule_source: "none", rule: "", last_human_id: null };',
  "  return { record, seen: new Set() };",
  "};",
].join("\n");

const stubs: Record<string, string> = { sources: sources_stub, bash: bash_stub, review: review_stub };

const plugin: Plugin = {
  name: "pure-policy",
  setup(api) {
    const stubbed = (name: string) => (args: { importer: string }) => (args.importer.endsWith("decide.ts") ? { path: name, namespace: "policy" } : undefined);
    api.onResolve({ filter: /sources\.ts$/ }, stubbed("sources"));
    api.onResolve({ filter: /git-bash\.ts$/ }, stubbed("bash"));
    api.onResolve({ filter: /review-verdict\.ts$/ }, stubbed("review"));
    api.onLoad({ filter: /.*/, namespace: "policy" }, (args) => ({ loader: "js", contents: stubs[args.path] ?? "" }));
  },
};

export const load_policy = async (): Promise<Policy> => {
  const compiled = await build({
    stdin: { contents: 'export { decide_command } from "./electron/permissions/decide.ts";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [plugin],
    logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0]?.contents ?? new Uint8Array()).toString("base64"));
};

export const unresolved_gap = /could not resolve every program this command starts or every target it deletes/;

export const reviewed_with_gap = (): boolean => policy_reviews().at(-1)?.input.action.gaps.some((gap) => unresolved_gap.test(gap)) ?? false;

export const unresolved_expectation = (mode: PermissionMode): "ask" | "run" => (mode === "ask" ? "ask" : "run");
