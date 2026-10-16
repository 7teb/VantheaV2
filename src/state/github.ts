import type { GithubRepoRef, GithubRepoView } from "../../shared/github-view.ts";
import type { GithubRepoChange } from "../../shared/ipc/github.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export type GithubState = { views: Record<string, GithubRepoView> };

const none: GithubRepoView = { kind: "none" };

export const github_store = create_store<GithubState>({ views: {} });

export const github_view_of = (state: GithubState, root: string | null): GithubRepoView => (root === null ? none : (state.views[root] ?? none));

const repo_of = (view: GithubRepoView | undefined): GithubRepoRef | null => (view && view.kind !== "none" ? view.repo : null);

const same_repo = (left: GithubRepoRef | null, right: GithubRepoRef | null): boolean =>
  left !== null && right !== null && left.host === right.host && left.owner.toLowerCase() === right.owner.toLowerCase() && left.name.toLowerCase() === right.name.toLowerCase();

export const apply_github_change = ({ root, view }: GithubRepoChange) =>
  github_store.update((state) => {
    const known = state.views[root];
    if (view.kind === "loading" && known?.kind !== "loading" && same_repo(repo_of(known), view.repo)) {
      return state;
    }
    return { views: { ...state.views, [root]: view } };
  });

export const init_github = (): (() => void) => api.on("github:repo_changed", apply_github_change);
