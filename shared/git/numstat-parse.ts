export type NumstatRecord = { path: string; orig_path: string | null; added: number | null; removed: number | null };

export type RawRecord = { status: string; path: string; orig_path: string | null; old_mode: string; new_mode: string; old_oid: string; new_oid: string };

type DiffRecords = { numstat: NumstatRecord[]; raw: RawRecord[] };

const numstat_head = /^(\d+|-)\t(\d+|-)\t/;

const count = (value: string): number | null => (value === "-" ? null : Number(value));

const walk_records = (text: string): DiffRecords => {
  const tokens = text.split("\0");
  const records: DiffRecords = { numstat: [], raw: [] };
  let index = 0;
  const take = (): string => tokens[index++] ?? "";
  while (index < tokens.length) {
    const token = take();
    if (token.startsWith(":")) {
      const [old_mode = "", new_mode = "", old_oid = "", new_oid = "", status = ""] = token.slice(1).split(" ");
      const letter = status.charAt(0);
      const head = { status: letter, old_mode, new_mode, old_oid, new_oid };
      if (letter === "R" || letter === "C") {
        const orig_path = take();
        records.raw.push({ ...head, path: take(), orig_path });
      } else {
        records.raw.push({ ...head, path: take(), orig_path: null });
      }
      continue;
    }
    const head = numstat_head.exec(token);
    if (!head) continue;
    const added = count(head[1]);
    const removed = count(head[2]);
    const rest = token.slice(head[0].length);
    if (rest !== "") {
      records.numstat.push({ path: rest, orig_path: null, added, removed });
      continue;
    }
    const orig_path = take();
    records.numstat.push({ path: take(), orig_path, added, removed });
  }
  return records;
};

export const parse_numstat = (text: string): NumstatRecord[] => walk_records(text).numstat;

export const parse_raw = (text: string): RawRecord[] => walk_records(text).raw;
