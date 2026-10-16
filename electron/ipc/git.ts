import type { HistoryRequest } from "../../shared/git-view.ts";
import { git_service } from "../git/index.ts";
import { parse_scope, require_root } from "../project/files-root.ts";
import { require_record, require_string } from "../storage/coerce.ts";
import { emit, handle } from "./handle.ts";

const require_hash = (value: unknown): string => {
  const hash = require_string(value, "commit hash", 64);
  if (!/^[0-9a-f]{7,64}$/.test(hash)) {
    throw new Error("commit hash must be 7 to 64 lowercase hex characters");
  }
  return hash;
};

const require_history_request = (value: unknown): HistoryRequest => {
  const { fingerprint, offset } = require_record(value, "history request");
  if (fingerprint !== null && (typeof fingerprint !== "string" || fingerprint.length > 128)) {
    throw new Error("history fingerprint must be null or a string of at most 128 characters");
  }
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("history offset must be a non-negative integer");
  }
  return { fingerprint, offset };
};

export const register_git_ipc = () => {
  git_service.listen((event) => {
    if (event.kind === "view") emit("git:changed", { root: event.root, view: event.view });
  });
  handle("git:refresh", async (scope) => git_service.refresh(await require_root(parse_scope(scope))));
  handle("git:diff", async (scope, path) => git_service.diff(await require_root(parse_scope(scope)), require_string(path, "file path", 4000)));
  handle("git:line_counts", async (scope) => git_service.line_counts(await require_root(parse_scope(scope))));
  handle("git:history", async (scope, request) => git_service.history(await require_root(parse_scope(scope)), require_history_request(request)));
  handle("git:history_close", () => git_service.close_history());
  handle("git:commit", async (scope, hash) => git_service.commit(await require_root(parse_scope(scope)), require_hash(hash)));
  handle("git:commit_diff", async (scope, hash, path) =>
    git_service.commit_diff(await require_root(parse_scope(scope)), require_hash(hash), require_string(path, "file path", 4000)),
  );
};
