import type { GitRepoView } from "../git-view.ts";

export const tracked_branch = (view: GitRepoView, remote: string): string | null => {
  const upstream = view.branch.upstream;
  return upstream !== null && upstream.startsWith(`${remote}/`) ? upstream.slice(remote.length + 1) : null;
};

export const push_needed = (view: GitRepoView): boolean =>
  view.primary_remote !== null && (tracked_branch(view, view.primary_remote) === null || view.branch.upstream_gone || (view.branch.ahead ?? 0) > 0);

export const pushable = (view: GitRepoView): boolean => view.branch.name !== null && !view.branch.unborn && view.head !== null && view.operation === null && push_needed(view);

export const pr_head = (view: GitRepoView): string | null => {
  const name = view.branch.name;
  if (name === null || view.primary_remote === null) return null;
  return tracked_branch(view, view.primary_remote) ?? name;
};
