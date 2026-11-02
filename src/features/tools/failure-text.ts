import type { ToolFailure } from "../../../shared/tool-failure.ts";
import type { Translate } from "../../i18n/translate.ts";

export const failure_text = (t: Translate, failure: ToolFailure): string => {
  switch (failure.kind) {
    case "not_in_project":
      return t("tools.failure_not_in_project", { x: failure.path });
    case "replace_not_found":
      return t("tools.failure_replace_not_found", { x: failure.path });
    case "outside_project":
      return t("tools.failure_outside_project", { x: failure.path });
    case "web_no_key":
      return t("tools.failure_web_no_key");
    case "web_timeout":
      return t("tools.failure_web_timeout", { n: failure.seconds });
    case "web_unreadable":
      return t("tools.failure_web_unreadable");
    case "agent_not_running":
      return t("tools.failure_agent_not_running", { x: failure.name });
    case "reply":
      return failure.text;
  }
};
