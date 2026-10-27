import type { Translate } from "../../../../i18n/index.ts";
import type { CommitIssue, PushIssue } from "../../../../state/git-actions.ts";
import type { PrIssue } from "../../../../state/git-pr.ts";

export type NoticeText = { title: string; detail?: string; command?: string; command_tip?: string; quiet?: boolean };

export const identity_command = 'git config --global user.email "you@example.com"';

const output_head = (text: string): string => text.split("\n").slice(0, 3).join("\n");

const failed = (t: Translate, action: "write" | "commit" | "push" | "pr", error: string): NoticeText => ({
  title: t("git_actions.failed", { action: t(`git_actions.action_${action}`), error }),
});

const push_error = (t: Translate, issue: Extract<PushIssue, { kind: "error" }>): NoticeText => {
  const { error } = issue;
  const host = error.host ?? error.remote;
  switch (error.kind) {
    case "auth_required":
      return { title: t("git.fetch_auth", { host }), command: error.command ?? undefined, command_tip: t("git.fetch_auth_tip") };
    case "ssh_key_rejected":
      return { title: t("git.fetch_ssh", { host }), command: error.command ?? undefined };
    case "ssh_host_unknown":
      return { title: t("git.fetch_ssh_host", { host }), command: error.command ?? undefined };
    case "remote_not_found":
      return { title: t("git.fetch_not_found", { remote: error.remote }) };
    case "offline":
      return { title: t("git_actions.push_offline", { host }) };
    case "error":
      return failed(t, "push", error.detail);
  }
};

export const push_notice = (t: Translate, issue: PushIssue): NoticeText => {
  switch (issue.kind) {
    case "busy":
      return { title: t("git_actions.busy") };
    case "blocked":
      if (issue.reason === "operation") return { title: t("git_actions.finish_operation") };
      if (issue.reason === "insecure") return { title: t("git.autofetch_insecure") };
      return { title: t(issue.reason === "detached" ? "git_actions.push_detached" : issue.reason === "unborn" ? "git_actions.push_unborn" : "git_actions.push_no_remote") };
    case "programs":
      return { title: t("git_actions.programs", { keys: issue.keys.join(", ") }) };
    case "rejected":
      return { title: t("git_actions.rejected", { remote: issue.remote }) };
    case "remote_rejected":
      return { title: t("git_actions.remote_rejected", { remote: issue.remote }), detail: issue.detail };
    case "hook":
      return { title: t("git_actions.push_hook"), detail: output_head(issue.output) };
    case "error":
      return push_error(t, issue);
    case "failed":
      return failed(t, "push", issue.error);
  }
};

export const commit_notice = (t: Translate, issue: CommitIssue): NoticeText => {
  switch (issue.kind) {
    case "nothing":
      return { title: t("git_actions.nothing"), quiet: true };
    case "busy":
      return { title: t("git_actions.busy") };
    case "blocked":
      return { title: t(issue.reason === "operation" ? "git_actions.finish_operation" : "git_actions.resolve_conflicts") };
    case "programs":
      return { title: t("git_actions.programs", { keys: issue.keys.join(", ") }) };
    case "identity":
      return { title: t("git_actions.identity"), command: identity_command };
    case "hook":
      return { title: t("git_actions.hook"), detail: output_head(issue.output) };
    case "locked":
      return { title: t("git_actions.locked") };
    case "failed":
      return failed(t, "commit", issue.error);
    case "write_failed":
      return failed(t, "write", issue.error);
  }
};

export const pr_notice = (t: Translate, issue: PrIssue): NoticeText => {
  switch (issue.kind) {
    case "no_commits":
      return { title: t("git_actions.no_commits"), quiet: true };
    case "exists":
      return { title: t("git_actions.pr_exists"), quiet: true };
    case "push":
      return push_notice(t, issue.result);
    case "busy":
      return { title: t("git_actions.busy") };
    case "write_failed":
      return failed(t, "write", issue.error);
    case "failed":
      return failed(t, "pr", issue.error);
  }
};
