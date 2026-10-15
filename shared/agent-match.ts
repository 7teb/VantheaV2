const id_part = (id: string): string => id.slice(id.lastIndexOf("#") + 1).trim();

export const match_agents = <T extends { agent_id: string }>(owned: T[], id: string): T[] => {
  const key = id_part(id);
  const exact = owned.find((record) => record.agent_id === key);
  return exact ? [exact] : owned.filter((record) => key !== "" && (record.agent_id.startsWith(key) || record.agent_id.startsWith(`agent_${key}`)));
};
