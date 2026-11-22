import type { ModelEntry } from "../../shared/models.ts";
import { get_settings } from "../settings/store.ts";

export const claude_plan_serves = (model: Pick<ModelEntry, "claude_code">): boolean => get_settings().claude_billing === "claude" && model.claude_code !== undefined;
