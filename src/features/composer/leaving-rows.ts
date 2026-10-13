export type LeavingRow<T> = { item: T; index: number };

export type ShownRow<T> = { item: T; leaving: boolean };

export const shown_rows = <T>(items: T[], leaving: LeavingRow<T>[]): ShownRow<T>[] => {
  const rows = items.map((item) => ({ item, leaving: false }));
  for (const entry of [...leaving].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(entry.index, rows.length), 0, { item: entry.item, leaving: true });
  }
  return rows;
};

export const track_leaving = <T extends { id: string }>(previous: T[], next: T[], leaving: LeavingRow<T>[]): LeavingRow<T>[] => {
  const kept = (id: string) => next.some((item) => item.id === id);
  const departed = shown_rows(previous, leaving).flatMap((row, index) => (row.leaving || kept(row.item.id) ? [] : [{ item: row.item, index }]));
  return [...leaving.filter((entry) => !kept(entry.item.id)), ...departed];
};

export const drop_leaving = <T extends { id: string }>(leaving: LeavingRow<T>[], id: string): LeavingRow<T>[] => {
  const dropped = leaving.find((entry) => entry.item.id === id);
  if (!dropped) {
    return leaving;
  }
  return leaving
    .filter((entry) => entry !== dropped)
    .map((entry) => (entry.index > dropped.index ? { ...entry, index: entry.index - 1 } : entry));
};
