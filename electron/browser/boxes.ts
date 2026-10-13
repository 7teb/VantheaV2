import { call_on, cdp, evaluate_value, frame_session } from "./cdp.ts";
import type { Viewport } from "./input.ts";
import { error_text, type AxEntry, type BrowserTab, type Box, type FrameInfo } from "./state.ts";
import { hit_test, probe, quad_bounds, resolve_object } from "./target.ts";

type Located = AxEntry & { session_id: string };

type Offset = { x: number; y: number };

const has_area = (box: Box) => box.right > box.left && box.bottom > box.top;

const union_box = (quads: number[][]): Box | null => {
  const boxes = quads.filter((quad) => quad.length >= 8).map(quad_bounds).filter(has_area);
  if (!boxes.length) {
    return null;
  }
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
};

const clip = (box: Box, view: Viewport): Box | null => {
  const clipped = { left: Math.max(0, box.left), top: Math.max(0, box.top), right: Math.min(view.width, box.right), bottom: Math.min(view.height, box.bottom) };
  return has_area(clipped) ? clipped : null;
};

const owner_offset = async (tab: BrowserTab, frame_id: string, parent_session: string, signal: AbortSignal): Promise<Offset> => {
  const owner = await cdp<{ backendNodeId?: number }>(tab, "DOM.getFrameOwner", { frameId: frame_id }, parent_session, signal);
  const model = await cdp<{ model?: { content?: number[] } }>(tab, "DOM.getBoxModel", { backendNodeId: owner.backendNodeId }, parent_session, signal);
  const content = model.model?.content;
  if (!content || content.length < 8) {
    throw new Error(`the iframe ${frame_id} has no content box`);
  }
  const bounds = quad_bounds(content);
  return { x: bounds.left, y: bounds.top };
};

const frame_offset = async (tab: BrowserTab, frames: Map<string, FrameInfo>, frame_id: string, signal: AbortSignal): Promise<Offset> => {
  let offset = { x: 0, y: 0 };
  let current = frames.get(frame_id);
  const seen = new Set<string>();
  while (current?.parent_id && !seen.has(current.frame_id)) {
    seen.add(current.frame_id);
    const own_session = frame_session(current.frame_id, frames, tab.sessions);
    const parent_session = frame_session(current.parent_id, frames, tab.sessions);
    if (own_session !== parent_session) {
      const owner = await owner_offset(tab, current.frame_id, parent_session, signal);
      offset = { x: offset.x + owner.x, y: offset.y + owner.y };
    }
    current = frames.get(current.parent_id);
  }
  return offset;
};

type Offsets = Map<string, Promise<Offset>>;

const cached_offset = (tab: BrowserTab, frames: Map<string, FrameInfo>, frame_id: string, offsets: Offsets, signal: AbortSignal): Promise<Offset> => {
  const known = offsets.get(frame_id);
  if (known) {
    return known;
  }
  const pending = frame_offset(tab, frames, frame_id, signal);
  offsets.set(frame_id, pending);
  return pending;
};

const visible_box = async (tab: BrowserTab, entry: Located, frames: Map<string, FrameInfo>, view: Viewport, offsets: Offsets, signal: AbortSignal): Promise<Box | null> => {
  if (!entry.backend_node_id) {
    return null;
  }
  const quads = await cdp<{ quads?: number[][] }>(tab, "DOM.getContentQuads", { backendNodeId: entry.backend_node_id }, entry.session_id, signal);
  const local = union_box(quads.quads ?? []);
  if (!local) {
    return null;
  }
  const offset = await cached_offset(tab, frames, entry.frame_id, offsets, signal);
  const box = clip({ left: local.left + offset.x, top: local.top + offset.y, right: local.right + offset.x, bottom: local.bottom + offset.y }, view);
  if (!box) {
    return null;
  }
  const object_id = await resolve_object(tab, entry, signal);
  const info = await probe(tab, entry.session_id, object_id, signal);
  if (!info?.connected || info.invisible || info.inert) {
    return null;
  }
  const center_x = (box.left + box.right) / 2 - offset.x - (local.left - info.rect.x);
  const center_y = (box.top + box.bottom) / 2 - offset.y - (local.top - info.rect.y);
  const hit = evaluate_value<{ ok: boolean }>(await call_on(tab, entry.session_id, object_id, hit_test, [center_x, center_y], signal));
  return hit?.ok ? box : null;
};

export const visible_boxes = async (tab: BrowserTab, entries: Located[], frames: Map<string, FrameInfo>, view: Viewport, signal: AbortSignal): Promise<(Box | null)[]> => {
  const offsets: Offsets = new Map();
  const boxes: (Box | null)[] = [];
  let unread = 0;
  let first_error = "";
  for (const entry of entries) {
    signal.throwIfAborted();
    try {
      boxes.push(await visible_box(tab, entry, frames, view, offsets, signal));
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      unread += 1;
      first_error ||= error_text(error);
      boxes.push(null);
    }
  }
  if (unread) {
    console.warn(`[browser] ${unread} of ${entries.length} controls in tab ${tab.tab_id} got no label because their layout could not be read, first error: ${first_error}`);
  }
  return boxes;
};
