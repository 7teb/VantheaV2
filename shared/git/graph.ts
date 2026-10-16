import type { GraphEdge } from "../git-view.ts";

export type GraphCommit = { hash: string; parents: string[] };

export type Lane = { expect: string; color: number };

export type LaneState = { lanes: (Lane | null)[]; next_color: number };

export type GraphPlace = { col: number; color: number; up: GraphEdge[]; down: GraphEdge[]; width: number };

export const empty_lanes: LaneState = { lanes: [], next_color: 0 };

const free_slot = (lanes: (Lane | null)[], taken: number): number => {
  const slot = lanes.findIndex((lane, index) => lane === null && index !== taken);
  return slot >= 0 ? slot : lanes.length;
};

const place_commit = (commit: GraphCommit, state: LaneState): { place: GraphPlace; state: LaneState } => {
  const before = state.lanes;
  let next_color = state.next_color;
  const own = before.findIndex((lane) => lane?.expect === commit.hash);
  const col = own >= 0 ? own : free_slot(before, -1);
  const own_lane = before[own];
  const color = own_lane ? own_lane.color : next_color++;
  const up: GraphEdge[] = [];
  const lanes: (Lane | null)[] = [];
  for (const [index, lane] of before.entries()) {
    if (!lane) {
      lanes.push(null);
      continue;
    }
    const joins = lane.expect === commit.hash;
    up.push({ from: index, to: joins ? col : index, color: lane.color });
    lanes.push(joins ? null : lane);
  }
  while (lanes.length <= col) {
    lanes.push(null);
  }
  const down: GraphEdge[] = [];
  const opened = new Set<number>();
  for (const [position, parent] of commit.parents.entries()) {
    const waiting = lanes.findIndex((lane) => lane?.expect === parent);
    const waiting_lane = lanes[waiting];
    if (waiting_lane) {
      down.push({ from: col, to: waiting, color: waiting_lane.color });
      continue;
    }
    const slot = position === 0 ? col : free_slot(lanes, col);
    const lane: Lane = { expect: parent, color: position === 0 ? color : next_color++ };
    lanes[slot] = lane;
    opened.add(slot);
    down.push({ from: col, to: slot, color: lane.color });
  }
  for (const [index, lane] of lanes.entries()) {
    if (lane && !opened.has(index)) {
      down.push({ from: index, to: index, color: lane.color });
    }
  }
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop();
  }
  const width = Math.max(before.length, lanes.length, col + 1);
  return { place: { col, color, up, down, width }, state: { lanes, next_color } };
};

export const lay_out = <T extends GraphCommit>(commits: readonly T[], start: LaneState): { rows: (T & GraphPlace)[]; state: LaneState } => {
  let state = start;
  const rows = commits.map((commit) => {
    const placed = place_commit(commit, state);
    state = placed.state;
    return { ...commit, ...placed.place };
  });
  return { rows, state };
};
