import assert from "node:assert/strict";
import { test } from "node:test";
import { read_ax_node } from "../electron/browser/ax.ts";
import { resolve_ref, snapshot_lifetime_ms, snapshot_tab_id, store_snapshot, sweep_stores } from "../electron/browser/refs.ts";
import { invalidate_tab, type Snapshot, type SnapshotRef } from "../electron/browser/state.ts";

const make_tab = (tab_id = "browser-1:a") => ({
  tab_id,
  epoch: 1,
  snapshots: new Map<string, Snapshot>(),
  visuals: new Map(),
  snapshot_seq: 0,
  waiters: new Set<() => void>(),
});

const button = (tab_id: string, epoch: number, created_at: number): SnapshotRef => ({
  ...read_ax_node({ backendDOMNodeId: 9, role: { value: "button" }, name: { value: "Save" } }),
  tab_id,
  session_id: "",
  epoch,
  created_at,
});

const snapshot_of = (tab: ReturnType<typeof make_tab>, created_at: number) =>
  store_snapshot(tab, { tab_id: tab.tab_id, epoch: tab.epoch, created_at, consumed: false, refs: new Map([["b1", button(tab.tab_id, tab.epoch, created_at)]]), frames: new Map() });

test("snapshot ids carry the tab id even when it contains colons", () => {
  const tab = make_tab();
  const snapshot = snapshot_of(tab, 1000);
  assert.equal(snapshot.snapshot_id, "browser-1:a:1:1");
  assert.equal(snapshot_tab_id(snapshot.snapshot_id), "browser-1:a");
  assert.equal(snapshot_of(tab, 1001).snapshot_id, "browser-1:a:1:2");
});

test("a fresh ref resolves and any spelling of it works", () => {
  const tab = make_tab();
  const snapshot = snapshot_of(tab, 1000);
  assert.equal(resolve_ref(tab, snapshot.snapshot_id, "ref_1", false, 1500).ref.name, "Save");
  assert.equal(resolve_ref(tab, snapshot.snapshot_id, "[b1]", false, 1500).ref_name, "b1");
});

test("an action consumes the whole snapshot", () => {
  const tab = make_tab();
  const snapshot = snapshot_of(tab, 1000);
  resolve_ref(tab, snapshot.snapshot_id, "b1", true, 1100);
  assert.throws(() => resolve_ref(tab, snapshot.snapshot_id, "b1", false, 1200), /stale/);
});

test("refs expire after the snapshot lifetime", () => {
  const tab = make_tab();
  const snapshot = snapshot_of(tab, 1000);
  assert.doesNotThrow(() => resolve_ref(tab, snapshot.snapshot_id, "b1", false, 1000 + snapshot_lifetime_ms));
  assert.throws(() => resolve_ref(tab, snapshot.snapshot_id, "b1", false, 1001 + snapshot_lifetime_ms), /stale/);
  assert.equal(tab.snapshots.size, 0);
});

test("a document change makes refs stale, while the same document keeps them valid", () => {
  const tab = make_tab();
  const first = snapshot_of(tab, 1000);
  invalidate_tab(tab, true);
  assert.throws(() => resolve_ref(tab, first.snapshot_id, "b1", false, 1100), /stale/);
  const second = snapshot_of(tab, 1200);
  assert.equal(resolve_ref(tab, second.snapshot_id, "b1", false, 1300).ref.name, "Save");
});

test("a snapshot of another tab is stale for this tab", () => {
  const tab = make_tab("browser-2");
  const other = make_tab("browser-3");
  const snapshot = snapshot_of(other, 1000);
  assert.throws(() => resolve_ref(tab, snapshot.snapshot_id, "b1", false, 1100), /stale/);
});

test("an unknown ref names real examples from the snapshot", () => {
  const tab = make_tab();
  const snapshot = snapshot_of(tab, 1000);
  assert.throws(() => resolve_ref(tab, snapshot.snapshot_id, "b9", false, 1100), /Unknown browser reference "b9".*for example b1/);
});

test("interactions that keep the document still drop snapshots but keep the epoch", () => {
  const tab = make_tab();
  let woke = 0;
  tab.waiters.add(() => {
    woke += 1;
  });
  snapshot_of(tab, 1000);
  invalidate_tab(tab, false);
  assert.equal(tab.epoch, 1);
  assert.equal(tab.snapshots.size, 0);
  assert.equal(woke, 1);
});

test("sweeping keeps young snapshots", () => {
  const tab = make_tab();
  snapshot_of(tab, 1000);
  snapshot_of(tab, 20000);
  sweep_stores(tab, 1000 + snapshot_lifetime_ms + 1);
  assert.equal(tab.snapshots.size, 1);
});
