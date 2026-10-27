import type { PrCli, PushResult } from "../../shared/ipc/git-actions.ts";
import { api } from "../api/bridge.ts";
import { ipc_error_text } from "../features/settings/panes/ipc-error.ts";
import { create_store } from "./create-store.ts";
import { action_target } from "./git-actions.ts";
import { git_store } from "./git.ts";
import { github_store, github_view_of } from "./github.ts";

export type PrIssue =
  | { kind: "no_commits" }
  | { kind: "exists"; url: string | null }
  | { kind: "push"; result: Exclude<PushResult, { kind: "done" }> }
  | { kind: "busy" }
  | { kind: "write_failed"; error: string }
  | { kind: "failed"; error: string };

export type PrDraft = {
  open: boolean;
  branch: string | null;
  title: string;
  body: string;
  base: string | null;
  push_first: number | null;
  writing: boolean;
  creating: boolean;
  issue: PrIssue | null;
  cli: PrCli | null;
};

export type GitPrState = { drafts: Record<string, PrDraft> };

const closed: PrDraft = { open: false, branch: null, title: "", body: "", base: null, push_first: null, writing: false, creating: false, issue: null, cli: null };

export const git_pr_store = create_store<GitPrState>({ drafts: {} });

export const pr_of = (state: GitPrState, root: string | null): PrDraft => (root === null ? closed : (state.drafts[root] ?? closed));

const patch = (root: string, change: Partial<PrDraft>) => git_pr_store.update((state) => ({ drafts: { ...state.drafts, [root]: { ...pr_of(state, root), ...change } } }));

const branch_of = (root: string): string | null => {
  const view = git_store.get().views[root];
  return view?.kind === "repo" ? (view.branch.name ?? "") : null;
};

export const set_pr_text = (root: string, change: Partial<Pick<PrDraft, "title" | "body">>) => patch(root, change);

export const close_pr = (root: string) => git_pr_store.update((state) => ({ drafts: { ...state.drafts, [root]: closed } }));

export const open_pr = async () => {
  const at = action_target();
  if (!at) return;
  const github = github_view_of(github_store.get(), at.root);
  patch(at.root, { ...closed, open: true, branch: branch_of(at.root), base: github.kind === "data" ? github.default_branch : null, writing: true });
  try {
    const result = await api.invoke("github:write_pr", at.scope);
    if (result.kind === "text") patch(at.root, { title: result.title, body: result.body, base: result.base, push_first: result.push_first });
    else if (result.kind === "cli") patch(at.root, { cli: result });
    else if (result.kind === "no_commits") patch(at.root, { issue: result });
    else patch(at.root, { issue: { kind: "write_failed", error: result.error } });
  } catch (error) {
    console.error(`[github] github:write_pr failed for ${at.root}`, error);
    patch(at.root, { issue: { kind: "write_failed", error: ipc_error_text(error) } });
  } finally {
    patch(at.root, { writing: false });
  }
};

export const create_pr = async () => {
  const at = action_target();
  if (!at) return;
  const draft = pr_of(git_pr_store.get(), at.root);
  if (draft.base === null) return;
  patch(at.root, { creating: true, issue: null });
  try {
    const result = await api.invoke("github:create_pr", at.scope, { title: draft.title, body: draft.body, base: draft.base });
    if (result.kind === "done") {
      close_pr(at.root);
      return;
    }
    if (result.kind === "cli") patch(at.root, { cli: result });
    else if (result.kind === "push") patch(at.root, { issue: result.result.kind === "done" ? null : { kind: "push", result: result.result } });
    else patch(at.root, { issue: result });
  } catch (error) {
    console.error(`[github] github:create_pr failed for ${at.root}`, error);
    patch(at.root, { issue: { kind: "failed", error: ipc_error_text(error) } });
  } finally {
    git_pr_store.update((state) => (state.drafts[at.root]?.creating ? { drafts: { ...state.drafts, [at.root]: { ...pr_of(state, at.root), creating: false } } } : state));
  }
};

const settle_branches = () => {
  const moved = Object.entries(git_pr_store.get().drafts).filter(([root, draft]) => draft.open && git_store.get().views[root]?.kind === "repo" && draft.branch !== branch_of(root));
  for (const [root] of moved) close_pr(root);
};

export const init_git_pr = (): (() => void) => git_store.subscribe(settle_branches);
