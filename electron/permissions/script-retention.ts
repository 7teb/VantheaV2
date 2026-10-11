import type { ReviewActor, ReviewRecord, ReviewScript, ReviewVerdict } from "../../shared/review.ts";

export type RetainedScript = {
  key: string;
  path: string;
  sha256: string | null;
  verdict: ReviewVerdict;
  summary: string | null;
  chars: number;
  role: ReviewScript["role"];
  change: ReviewScript["change"];
  sent: boolean;
  by: string | null;
  at: number;
};

const strictness: Record<ReviewVerdict, number> = { allow: 0, review: 1, deny: 2 };

const summary_chars = 200;

export const actor_label = (actor: ReviewActor): string =>
  actor.kind === "main" ? "main" : `${actor.name}#${actor.id.replace(/^agent_/, "").replace(/[^0-9a-f]/gi, "").slice(0, 8)}`;

export const visible_to = (record: ReviewRecord, self: ReviewActor): boolean => record.actor.id === self.id || record.verdict !== "allow";

export const retained_scripts = (records: ReviewRecord[], self: ReviewActor): RetainedScript[] => {
  const by_key = new Map<string, RetainedScript>();
  for (const record of [...records].sort((a, b) => a.at - b.at)) {
    if (!visible_to(record, self)) {
      continue;
    }
    for (const script of record.scripts ?? []) {
      const key = `${script.path.toLowerCase()}|${script.sha256 ?? "absent"}`;
      const summary = script.sent ? (script.summary ?? (record.reason.slice(0, summary_chars) || null)) : null;
      const known = by_key.get(key);
      if (!known) {
        by_key.set(key, {
          key,
          path: script.path,
          sha256: script.sha256,
          verdict: record.verdict,
          summary,
          chars: script.chars,
          role: script.role,
          change: script.change,
          sent: script.sent,
          by: record.actor.id === self.id ? null : actor_label(record.actor),
          at: record.at,
        });
        continue;
      }
      if (strictness[record.verdict] > strictness[known.verdict]) known.verdict = record.verdict;
      known.summary ??= summary;
      known.sent ||= script.sent;
      known.change ??= script.change;
      known.at = record.at;
    }
  }
  return [...by_key.values()];
};

export const retained_line = (entry: RetainedScript): string =>
  JSON.stringify({
    path: entry.path,
    hash: (entry.sha256 ?? "absent").slice(0, 16),
    verdict: entry.verdict,
    ...(entry.sent && entry.summary ? { summary: entry.summary } : {}),
    chars: entry.chars,
    role: entry.role,
    ...(entry.by ? { by: entry.by } : {}),
    ...(entry.change ? { change: entry.change } : {}),
    ...(entry.sent ? {} : { sent: false }),
  });

export const fit_retained = (entries: RetainedScript[], max_bytes: number, drop_allows: boolean): string[] => {
  const kept = [...entries];
  const size = () => kept.reduce((total, entry) => total + Buffer.byteLength(retained_line(entry)) + 1, 0);
  let dropped = 0;
  while ((drop_allows || size() > max_bytes) && kept.some((entry) => entry.verdict === "allow")) {
    const index = kept.findIndex((entry) => entry.verdict === "allow");
    kept.splice(index, 1);
    dropped += 1;
    if (!drop_allows && size() <= max_bytes) break;
  }
  return [...(dropped ? [`(${dropped} earlier allowed scripts not shown)`] : []), ...kept.map(retained_line)];
};
