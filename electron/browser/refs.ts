import { normalize_ref } from "./ax.ts";
import type { BrowserTab, Snapshot, SnapshotRef } from "./state.ts";

export const snapshot_lifetime_ms = 30000;

const visual_lifetime_ms = 30000;

export type RefHolder = Pick<BrowserTab, "tab_id" | "active" | "epoch" | "snapshots" | "visuals">;

export type ResolvedRef = { snapshot: Snapshot; ref: SnapshotRef; ref_name: string };

const snapshot_id_for = (tab_id: string, epoch: number, sequence: number) => `${tab_id}:${epoch}:${sequence}`;

export const snapshot_tab_id = (snapshot_id: string) => snapshot_id.split(":").slice(0, -2).join(":");

export const sweep_stores = (tab: RefHolder, now: number) => {
  for (const [id, snapshot] of tab.snapshots) {
    if (now - snapshot.created_at > snapshot_lifetime_ms) {
      tab.snapshots.delete(id);
    }
  }
  for (const [id, visual] of tab.visuals) {
    if (now - visual.created_at > visual_lifetime_ms) {
      tab.visuals.delete(id);
    }
  }
};

const stale = (ref_name: string) => new Error(`Reference ${ref_name} is stale. Call browser_snapshot again.`);

export const resolve_ref = (tab: RefHolder, snapshot_id: string, requested: string, consume: boolean, now: number): ResolvedRef => {
  const ref_name = normalize_ref(requested);
  if (snapshot_tab_id(snapshot_id) !== tab.tab_id) {
    throw stale(requested);
  }
  sweep_stores(tab, now);
  const snapshot = tab.snapshots.get(snapshot_id);
  if (!snapshot || snapshot.consumed || !tab.active || snapshot.epoch !== tab.epoch) {
    throw stale(requested);
  }
  const ref = snapshot.refs.get(ref_name);
  if (!ref) {
    const examples = [...snapshot.refs.keys()].slice(0, 8).join(", ");
    throw new Error(`Unknown browser reference "${requested}". Use an exact ref from this snapshot${examples ? `, for example ${examples}` : ""}.`);
  }
  if (consume) {
    snapshot.consumed = true;
  }
  return { snapshot, ref, ref_name };
};

export const store_snapshot = (tab: RefHolder & Pick<BrowserTab, "snapshot_seq">, snapshot: Omit<Snapshot, "snapshot_id">): Snapshot => {
  tab.snapshot_seq += 1;
  const stored: Snapshot = { ...snapshot, snapshot_id: snapshot_id_for(tab.tab_id, snapshot.epoch, tab.snapshot_seq) };
  tab.snapshots.set(stored.snapshot_id, stored);
  sweep_stores(tab, snapshot.created_at);
  return stored;
};
