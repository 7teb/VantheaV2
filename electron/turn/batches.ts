import type { Tool } from "../tools/types.ts";

export const tool_batches = <T extends { tool: Tool | null }>(calls: T[]): T[][] => {
  const batches: T[][] = [];
  for (const call of calls) {
    const open = batches.at(-1);
    if (call.tool?.concurrent && open?.[0].tool?.concurrent) {
      open.push(call);
      continue;
    }
    batches.push([call]);
  }
  return batches;
};
