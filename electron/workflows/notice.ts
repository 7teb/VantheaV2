import type { WorkflowStatus } from "../../shared/workflow.ts";

export type WorkflowReport = { chat_id: string; run_id: string; name: string; status: WorkflowStatus; text: string; held: boolean };

export const workflow_note_content = (text: string): string =>
  `[Internal app event, not a user message. A workflow you started ended. Its return value or error is below. Use it to continue the work the workflow was for: read the full value from the result file when the inline value is cut, check what the agents found before you present it, and do not rerun what it already covers. It needs no acknowledgment.]\n\n${text}`;
