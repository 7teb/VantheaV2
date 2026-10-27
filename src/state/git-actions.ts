import type { FilesScope } from "../../shared/ipc/files.ts";
import type { CommitResult, PushResult, WriteGuard } from "../../shared/ipc/git-actions.ts";
import { api } from "../api/bridge.ts";
import { ipc_error_text } from "../features/settings/panes/ipc-error.ts";
import { create_store } from "./create-store.ts";
import { files_store, shown_view } from "./files.ts";
import { git_store } from "./git.ts";

export type CommitIssue = Exclude<CommitResult, { kind: "done" }> | { kind: "write_failed"; error: string };

export type PushIssue = Exclude<PushResult, { kind: "done" }> | { kind: "failed"; error: string };

export type CommitBoxState = { message: string; writing: boolean; committing: boolean; issue: CommitIssue | null; left_out: string[] };

export type RootActions = { branch: string | null; guard: WriteGuard | null; commit: CommitBoxState; pushing: boolean; push_issue: PushIssue | null };

export type GitActionsState = { roots: Record<string, RootActions> };

export type ActionTarget = { root: string; scope: FilesScope };

const idle_commit: CommitBoxState = { message: "", writing: false, committing: false, issue: null, left_out: [] };

const idle_actions: RootActions = { branch: null, guard: null, commit: idle_commit, pushing: false, push_issue: null };

export const git_actions_store = create_store<GitActionsState>({ roots: {} });

export const actions_of = (state: GitActionsState, root: string | null): RootActions => (root === null ? idle_actions : (state.roots[root] ?? idle_actions));

export const action_target = (): ActionTarget | null => {
  const view = shown_view(files_store.get());
  const root = view.root.root?.path ?? null;
  return root === null ? null : { root, scope: view.scope };
};

const patch = (root: string, change: (actions: RootActions) => RootActions) =>
  git_actions_store.update((state) => ({ roots: { ...state.roots, [root]: change(actions_of(state, root)) } }));

const patch_commit = (root: string, change: Partial<CommitBoxState>) => patch(root, (actions) => ({ ...actions, commit: { ...actions.commit, ...change } }));

export const set_commit_message = (root: string, message: string) => patch_commit(root, { message });

export const load_write_guard = async (at: ActionTarget) => {
  try {
    const guard = await api.invoke("git:write_guard", at.scope);
    patch(at.root, (actions) => ({ ...actions, guard }));
  } catch (error) {
    console.error(`[git] git:write_guard failed for ${at.root}`, error);
  }
};

export const write_commit_message = async () => {
  const at = action_target();
  if (!at) return;
  patch_commit(at.root, { writing: true, issue: null, left_out: [] });
  try {
    const result = await api.invoke("git:write_message", at.scope);
    if (result.kind === "text") patch_commit(at.root, { message: result.text });
    else patch_commit(at.root, { issue: result.kind === "failed" ? { kind: "write_failed", error: result.error } : { kind: "nothing", left_out: [] } });
  } catch (error) {
    console.error(`[git] git:write_message failed for ${at.root}`, error);
    patch_commit(at.root, { issue: { kind: "write_failed", error: ipc_error_text(error) } });
  } finally {
    patch_commit(at.root, { writing: false });
  }
};

export const commit_changes = async () => {
  const at = action_target();
  if (!at) return;
  const message = actions_of(git_actions_store.get(), at.root).commit.message;
  patch_commit(at.root, { committing: true, issue: null, left_out: [] });
  try {
    const result = await api.invoke("git:commit_changes", at.scope, message);
    if (result.kind === "done") patch_commit(at.root, { message: "", left_out: result.left_out });
    else patch_commit(at.root, { issue: result, left_out: result.kind === "nothing" ? result.left_out : [] });
  } catch (error) {
    console.error(`[git] git:commit_changes failed for ${at.root}`, error);
    patch_commit(at.root, { issue: { kind: "failed", error: ipc_error_text(error) } });
  } finally {
    patch_commit(at.root, { committing: false });
    void load_write_guard(at);
  }
};

export const push_branch = async () => {
  const at = action_target();
  if (!at) return;
  patch(at.root, (actions) => ({ ...actions, pushing: true, push_issue: null }));
  let issue: PushIssue | null = null;
  try {
    const result = await api.invoke("git:push", at.scope);
    issue = result.kind === "done" ? null : result;
  } catch (error) {
    console.error(`[git] git:push failed for ${at.root}`, error);
    issue = { kind: "failed", error: ipc_error_text(error) };
  } finally {
    patch(at.root, (actions) => ({ ...actions, pushing: false, push_issue: issue }));
    void load_write_guard(at);
  }
};

const branch_of = (root: string): string | null => {
  const view = git_store.get().views[root];
  return view?.kind === "repo" ? (view.branch.name ?? "") : null;
};

const settle_branches = () => {
  const { roots } = git_actions_store.get();
  const moved = Object.entries(roots).filter(([root, actions]) => actions.branch !== branch_of(root) && git_store.get().views[root]?.kind === "repo");
  if (moved.length === 0) return;
  git_actions_store.update((state) => ({
    roots: { ...state.roots, ...Object.fromEntries(moved.map(([root, actions]) => [root, actions.branch === null ? { ...actions, branch: branch_of(root) } : { ...idle_actions, guard: actions.guard, branch: branch_of(root) }])) },
  }));
};

export const init_git_actions = (): (() => void) => {
  const stop_git = git_store.subscribe(settle_branches);
  const stop_actions = git_actions_store.subscribe(settle_branches);
  return () => {
    stop_git();
    stop_actions();
  };
};
