import { emit } from "./channel.ts";
import type { GithubRepoView } from "../github-view.ts";

export type GithubRepoChange = { root: string; view: GithubRepoView };

export const github_channels = {
  "github:repo_changed": emit<GithubRepoChange>(),
} as const;
