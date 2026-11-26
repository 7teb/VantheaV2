export const main_approval_id = (request_id: string): string => `m:${request_id}`;

export const agent_approval_id = (agent_id: string, run_id: string, request_id: string): string => `a:${agent_id}:${run_id}:${request_id}`;

export const parse_approval_id = (
  id: string,
): { source: "main"; request_id: string } | { source: "agent"; agent_id: string; run_id: string; request_id: string } | null => {
  if (id.startsWith("m:")) {
    const request_id = id.slice(2);
    return request_id ? { source: "main", request_id } : null;
  }
  if (!id.startsWith("a:")) {
    return null;
  }
  const [agent_id = "", run_id = "", ...rest] = id.slice(2).split(":");
  const request_id = rest.join(":");
  return agent_id && run_id && request_id ? { source: "agent", agent_id, run_id, request_id } : null;
};
