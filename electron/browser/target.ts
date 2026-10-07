import { read_ax_node, type AxNode } from "./ax.ts";
import { call_for_object, call_on, cdp, evaluate_value, frame_session, read_frames } from "./cdp.ts";
import type { BrowserTab, FrameInfo, SnapshotRef } from "./state.ts";

type Rect = { x: number; y: number; width: number; height: number };

type Probe = {
  connected: boolean;
  text: boolean;
  hidden_input: boolean;
  toggle: boolean;
  protected: boolean;
  disabled: boolean;
  invisible: string;
  inert: boolean;
  rect: Rect;
};

type Hit = { ok: boolean; by: string };

type Point = { x: number; y: number };

type Placement = { point: Point } | { problem: string };

export type LiveNode = { object_id: string; protected: boolean; x: number; y: number; session_id: string; via_label: boolean };

const scroll_into_view = `function(){const target=this.nodeType===3?this.parentElement:this;target.scrollIntoView({block:"center",inline:"center",behavior:"instant"});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}`;

const probe_node = `function(){
  const text=this.nodeType===3;
  const element=text?this.parentElement:this;
  if(!this.isConnected||!element)return{connected:false};
  const style=getComputedStyle(element);
  let box=element.getBoundingClientRect();
  if(text){
    const range=this.ownerDocument.createRange();
    range.selectNodeContents(this);
    box=[...range.getClientRects()].find(rect=>rect.width>0&&rect.height>0)||range.getBoundingClientRect();
  }
  const type=String(element.getAttribute("type")||"").toLowerCase();
  const input=!text&&element.localName==="input";
  const control=text?element.closest("label")?.control||element.closest("button,select,textarea,option,fieldset"):element;
  const invisible=style.display==="none"?"display: none":style.visibility!=="visible"?"visibility: hidden":Number(style.opacity)===0?"opacity: 0":box.width<=0||box.height<=0?"zero size":"";
  return{
    connected:true,
    text,
    hidden_input:input&&type==="hidden",
    toggle:input&&(type==="radio"||type==="checkbox"),
    protected:!text&&(type==="password"||element.matches("[autocomplete=current-password],[autocomplete=new-password]")),
    disabled:Boolean(control?.matches?.(":disabled"))||Boolean(element.closest('[aria-disabled="true"]')),
    invisible,
    inert:style.pointerEvents==="none",
    rect:{x:box.x,y:box.y,width:box.width,height:box.height}
  };
}`;

const hit_test = `function(x,y){const hit=this.ownerDocument.elementFromPoint(x,y);if(!hit)return{ok:false,by:""};const own=this===hit||this.contains(hit)||hit.contains(this)||this.control===hit;return{ok:own,by:own?"":hit.localName}}`;

const visible_label = `function(){for(const label of this.labels||[]){const style=getComputedStyle(label);const box=label.getBoundingClientRect();if(box.width>0&&box.height>0&&style.display!=="none"&&style.visibility==="visible"&&Number(style.opacity)!==0&&style.pointerEvents!=="none")return label}return null}`;

const stale = (problem: string) => new Error(`${problem} Call browser_snapshot again.`);

const describe = (ref: SnapshotRef) => {
  const kind = ref.role === "statictext" ? "text" : ref.role;
  return ref.name ? `${kind} ${JSON.stringify(ref.name.slice(0, 80))}` : kind;
};

export const resolve_object = async (tab: BrowserTab, ref: SnapshotRef, signal: AbortSignal) => {
  const resolved = await cdp<{ object?: { objectId?: string } }>(tab, "DOM.resolveNode", { backendNodeId: ref.backend_node_id }, ref.session_id, signal);
  const object_id = resolved.object?.objectId;
  if (!object_id) {
    throw stale("Reference is stale.");
  }
  return object_id;
};

const scroll_frame_owners = async (tab: BrowserTab, frame_id: string, frames: Map<string, FrameInfo>, signal: AbortSignal) => {
  let current = frames.get(frame_id);
  const seen = new Set<string>();
  while (current?.parent_id && !seen.has(current.frame_id)) {
    seen.add(current.frame_id);
    const parent_session = frame_session(current.parent_id, frames, tab.sessions);
    const owner = await cdp<{ backendNodeId?: number }>(tab, "DOM.getFrameOwner", { frameId: current.frame_id }, parent_session, signal);
    const resolved = await cdp<{ object?: { objectId?: string } }>(tab, "DOM.resolveNode", { backendNodeId: owner.backendNodeId }, parent_session, signal);
    const object_id = resolved.object?.objectId;
    if (!object_id) {
      throw stale("Could not resolve the iframe that contains this reference.");
    }
    await call_on(tab, parent_session, object_id, scroll_into_view, [], signal);
    current = frames.get(current.parent_id);
  }
};

const quad_bounds = (quad: number[]) => {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};

const quad_center = (quad: number[]): Point => {
  const bounds = quad_bounds(quad);
  return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
};

const has_area = (quad: number[]) => {
  if (quad.length < 8) {
    return false;
  }
  const bounds = quad_bounds(quad);
  return bounds.right > bounds.left && bounds.bottom > bounds.top;
};

const probe = async (tab: BrowserTab, session_id: string, object_id: string, signal: AbortSignal) =>
  evaluate_value<Probe>(await call_on(tab, session_id, object_id, probe_node, [], signal));

const place = async (tab: BrowserTab, session_id: string, object_id: string, info: Probe, signal: AbortSignal): Promise<Placement> => {
  if (info.invisible) {
    return { problem: `is not visible (${info.invisible})` };
  }
  if (info.inert) {
    return { problem: "does not take pointer input (pointer-events: none)" };
  }
  const quads = await cdp<{ quads?: number[][] }>(tab, "DOM.getContentQuads", { objectId: object_id }, session_id, signal);
  const quad = (quads.quads ?? []).find(has_area);
  if (!quad) {
    return { problem: "has no box on the page" };
  }
  const center = [info.rect.x + info.rect.width / 2, info.rect.y + info.rect.height / 2];
  const hit = evaluate_value<Hit>(await call_on(tab, session_id, object_id, hit_test, center, signal));
  if (!hit?.ok) {
    return { problem: hit?.by ? `is covered by another element (<${hit.by}>) at its click point` : "lies outside the visible part of the page" };
  }
  return { point: quad_center(quad) };
};

const label_point = async (tab: BrowserTab, session_id: string, object_id: string, scroll: boolean, signal: AbortSignal): Promise<Point | null> => {
  const label_id = await call_for_object(tab, session_id, object_id, visible_label, [], signal);
  if (!label_id) {
    return null;
  }
  if (scroll) {
    await call_on(tab, session_id, label_id, scroll_into_view, [], signal);
  }
  const info = await probe(tab, session_id, label_id, signal);
  if (!info?.connected) {
    return null;
  }
  const placed = await place(tab, session_id, label_id, info, signal);
  return "point" in placed ? placed.point : null;
};

export const live_node = async (tab: BrowserTab, frames: Map<string, FrameInfo>, ref: SnapshotRef, scroll: boolean, signal: AbortSignal): Promise<LiveNode> => {
  if (tab.epoch !== ref.epoch) {
    throw stale("Reference is stale.");
  }
  const partial = await cdp<{ nodes?: AxNode[] }>(tab, "Accessibility.getPartialAXTree", { backendNodeId: ref.backend_node_id, fetchRelatives: false }, ref.session_id, signal);
  const node = (partial.nodes ?? []).find((entry) => Number(entry.backendDOMNodeId) === ref.backend_node_id);
  const current = node ? read_ax_node(node) : null;
  if (!current || current.role !== ref.role || current.name !== ref.name) {
    throw stale("Reference changed.");
  }
  const object_id = await resolve_object(tab, ref, signal);
  if (scroll) {
    await call_on(tab, ref.session_id, object_id, scroll_into_view, [], signal);
    if (tab.epoch !== ref.epoch) {
      throw stale("Reference changed while scrolling.");
    }
    if (ref.frame_id) {
      await scroll_frame_owners(tab, ref.frame_id, frames.size ? frames : await read_frames(tab, signal), signal);
    }
  }
  const info = await probe(tab, ref.session_id, object_id, signal);
  if (!info?.connected) {
    throw stale("Reference is no longer part of the page.");
  }
  const target = describe(ref);
  if (info.hidden_input) {
    throw new Error(`The ${target} is a hidden form field and takes no input.`);
  }
  if (info.disabled) {
    const state = info.text ? "belongs to a disabled control" : "is disabled";
    throw new Error(`The ${target} ${state}, so clicking or typing would do nothing.`);
  }
  const direct = await place(tab, ref.session_id, object_id, info, signal);
  if ("point" in direct) {
    return { object_id, protected: ref.protected || info.protected, ...direct.point, session_id: ref.session_id, via_label: false };
  }
  const label = info.toggle ? await label_point(tab, ref.session_id, object_id, scroll, signal) : null;
  if (label) {
    return { object_id, protected: ref.protected || info.protected, ...label, session_id: ref.session_id, via_label: true };
  }
  const no_label = info.toggle ? ", and it has no visible, uncovered label to click instead" : "";
  throw new Error(`The ${target} ${direct.problem}${no_label}.`);
};
