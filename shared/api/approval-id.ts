export const main_approval_id = (call_id: string): string => `m:${call_id}`;

export const agent_approval_id = (agent_id: string, run_id: string, call_id: string): string => `a:${agent_id}:${run_id}:${call_id}`;

export const parse_approval_id = (
  id: string,
): { source: "main"; call_id: string } | { source: "agent"; agent_id: string; run_id: string; call_id: string } | null => {
  if (id.startsWith("m:")) {
    const call_id = id.slice(2);
    return call_id ? { source: "main", call_id } : null;
  }
  if (!id.startsWith("a:")) {
    return null;
  }
  const [agent_id = "", run_id = "", ...rest] = id.slice(2).split(":");
  const call_id = rest.join(":");
  return agent_id && run_id && call_id ? { source: "agent", agent_id, run_id, call_id } : null;
};
