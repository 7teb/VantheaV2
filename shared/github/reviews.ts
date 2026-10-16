import type { GithubReviews } from "../github-view.ts";

export type ReviewInput = { login: string | null; state: string };

const decisive = new Set(["APPROVED", "CHANGES_REQUESTED"]);

export const summarize_reviews = (reviews: ReviewInput[], requested: string[], requested_teams: number): GithubReviews => {
  const latest = new Map<string, string>();
  for (const review of reviews) {
    if (review.login === null) continue;
    if (review.state === "DISMISSED") {
      latest.delete(review.login);
      continue;
    }
    if (decisive.has(review.state)) latest.set(review.login, review.state);
  }
  const waiting = new Set(requested);
  let approved = 0;
  let changes_requested = 0;
  for (const [login, state] of latest) {
    if (waiting.has(login)) continue;
    if (state === "APPROVED") approved += 1;
    else changes_requested += 1;
  }
  return { approved, changes_requested, pending: waiting.size + requested_teams };
};
