import { max_commit_message, max_pr_body, max_pr_title, type PrRequest } from "../../shared/ipc/git-actions.ts";
import { git_service } from "../git/index.ts";
import { create_pr, write_pr } from "../github/pr-flow.ts";
import { parse_scope, require_root } from "../project/files-root.ts";
import { write_commit_message } from "../side/commit-message.ts";
import { require_record, require_string } from "../storage/coerce.ts";
import { handle } from "./handle.ts";

const require_message = (value: unknown): string => {
  const message = require_string(value, "commit message", max_commit_message);
  if (!message.trim()) {
    throw new Error("commit message must not be blank");
  }
  return message;
};

const require_pr_request = (value: unknown): PrRequest => {
  const raw = require_record(value, "pull request");
  const title = require_string(raw.title, "pull request title", max_pr_title).trim();
  if (!title) {
    throw new Error("pull request title must not be blank");
  }
  return { title, body: require_string(raw.body, "pull request description", max_pr_body), base: require_string(raw.base, "pull request base") };
};

const root_of = async (scope: unknown): Promise<string> => require_root(parse_scope(scope));

export const register_git_actions_ipc = () => {
  handle("git:write_guard", async (scope) => git_service.write_guard(await root_of(scope)));
  handle("git:write_message", async (scope) => write_commit_message(await root_of(scope)));
  handle("git:commit_changes", async (scope, message) => {
    const text = require_message(message);
    return git_service.commit_changes(await root_of(scope), text);
  });
  handle("git:push", async (scope) => git_service.push(await root_of(scope)));
  handle("github:write_pr", async (scope) => write_pr(await root_of(scope)));
  handle("github:create_pr", async (scope, request) => {
    const checked = require_pr_request(request);
    return create_pr(await root_of(scope), checked);
  });
};
