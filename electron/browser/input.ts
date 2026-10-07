import { call_on, cdp, ensure_debugger, evaluate_value, type CallResult } from "./cdp.ts";
import { resolve_ref } from "./refs.ts";
import { invalidate_tab, type BrowserTab } from "./state.ts";
import { live_node, resolve_object } from "./target.ts";

export const allowed_keys = new Map<string, number>([
  ["Enter", 13],
  ["Escape", 27],
  ["Tab", 9],
  ["ArrowUp", 38],
  ["ArrowDown", 40],
  ["ArrowLeft", 37],
  ["ArrowRight", 39],
  ["Home", 36],
  ["End", 35],
  ["PageUp", 33],
  ["PageDown", 34],
  ["Backspace", 8],
  ["Delete", 46],
]);

export const allowed_modifiers = new Map<string, number>([
  ["Alt", 1],
  ["Control", 2],
  ["Meta", 4],
  ["Shift", 8],
]);

const focus_self = `function(){if(this.nodeType!==1)return false;this.focus({preventScroll:true});return document.activeElement===this||this.contains(document.activeElement)}`;

const scroll_container = `function(direction,amount){let target=this.nodeType===3?this.parentElement:this;while(target&&target!==document.documentElement){const s=getComputedStyle(target);if(/(auto|scroll)/.test(s.overflowY)&&target.scrollHeight>target.clientHeight)break;target=target.parentElement}const root=target&&target!==document.documentElement?target:document.scrollingElement;const step=amount==="page"?Math.max(1,root.clientHeight*.85):320;if(direction==="start")root.scrollTo({top:0,behavior:"instant"});else if(direction==="end")root.scrollTo({top:root.scrollHeight,behavior:"instant"});else root.scrollBy({top:direction==="up"?-step:step,behavior:"instant"});return true}`;

export const modifier_mask = (modifiers: string[]) => modifiers.reduce((mask, modifier) => mask | (allowed_modifiers.get(modifier) ?? 0), 0);

const key_event = async (tab: BrowserTab, key: string, code: string, virtual_key: number, modifiers: number, session_id: string, signal: AbortSignal) => {
  const payload = { key, code, windowsVirtualKeyCode: virtual_key, nativeVirtualKeyCode: virtual_key, modifiers };
  await cdp(tab, "Input.dispatchKeyEvent", { ...payload, type: "rawKeyDown" }, session_id, signal);
  await cdp(tab, "Input.dispatchKeyEvent", { ...payload, type: "keyUp" }, session_id, signal);
};

const dispatch_key = (tab: BrowserTab, key: string, modifiers: string[], session_id: string, signal: AbortSignal) => {
  const virtual_key = allowed_keys.get(key);
  if (virtual_key === undefined) {
    throw new Error(`Unsupported browser key: ${key}`);
  }
  return key_event(tab, key, key, virtual_key, modifier_mask(modifiers), session_id, signal);
};

export const click_point = async (tab: BrowserTab, x: number, y: number, double: boolean, session_id: string, signal: AbortSignal) => {
  await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, session_id, signal);
  const clicks = double ? [1, 2] : [1];
  for (const count of clicks) {
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: count }, session_id, signal);
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: count }, session_id, signal);
  }
};

export type Viewport = { x: number; y: number; width: number; height: number };

export const viewport = async (tab: BrowserTab, signal: AbortSignal): Promise<Viewport> => {
  await ensure_debugger(tab, signal);
  const result = await cdp<CallResult>(tab, "Runtime.evaluate", { expression: "({x:window.scrollX,y:window.scrollY,width:window.innerWidth,height:window.innerHeight})", returnByValue: true }, "", signal);
  return evaluate_value<Viewport>(result) ?? { x: 0, y: 0, width: 0, height: 0 };
};

const ref_target = async (tab: BrowserTab, snapshot_id: string, ref: string, signal: AbortSignal) => {
  const resolved = resolve_ref(tab, snapshot_id, ref, true, Date.now());
  const live = await live_node(tab, resolved.snapshot.frames, resolved.ref, true, signal);
  return { ...resolved, live };
};

export const click_ref = async (tab: BrowserTab, snapshot_id: string, ref: string, double: boolean, signal: AbortSignal) => {
  const start_epoch = tab.epoch;
  const target = await ref_target(tab, snapshot_id, ref, signal);
  if (tab.epoch !== start_epoch) {
    throw new Error("Reference changed before click. Call browser_snapshot again.");
  }
  await click_point(tab, target.live.x, target.live.y, double, target.live.session_id, signal);
  invalidate_tab(tab, false);
  return { ref_name: target.ref_name, label: target.ref.name || target.ref.role, via_label: target.live.via_label };
};

export const typed_text = (text: string, is_protected: boolean) => (is_protected ? `[masked input, ${text.length} characters]` : JSON.stringify(text));

export type TypeRequest = { snapshot_id: string; ref: string; text: string; clear: boolean; submit: boolean };

export const type_ref = async (tab: BrowserTab, request: TypeRequest, signal: AbortSignal) => {
  const target = await ref_target(tab, request.snapshot_id, request.ref, signal);
  const { live } = target;
  await click_point(tab, live.x, live.y, false, live.session_id, signal);
  await call_on(tab, live.session_id, live.object_id, focus_self, [], signal);
  if (request.clear) {
    await key_event(tab, "a", "KeyA", 65, allowed_modifiers.get("Control") ?? 0, live.session_id, signal);
    await dispatch_key(tab, "Backspace", [], live.session_id, signal);
  }
  await cdp(tab, "Input.insertText", { text: request.text }, live.session_id, signal);
  if (request.submit) {
    await dispatch_key(tab, "Enter", [], live.session_id, signal);
  }
  invalidate_tab(tab, false);
  return { ref_name: target.ref_name, label: target.ref.name || target.ref.role, protected: live.protected };
};

export const press_key = async (tab: BrowserTab, key: string, modifiers: string[], signal: AbortSignal) => {
  await ensure_debugger(tab, signal);
  await dispatch_key(tab, key, modifiers, "", signal);
  invalidate_tab(tab, false);
};

export type ScrollRequest = { direction: "up" | "down" | "start" | "end"; amount: "small" | "page"; target: { snapshot_id: string; ref: string } | null };

export const scroll_page = async (tab: BrowserTab, request: ScrollRequest, signal: AbortSignal) => {
  await ensure_debugger(tab, signal);
  if (request.target) {
    const { ref } = resolve_ref(tab, request.target.snapshot_id, request.target.ref, true, Date.now());
    const object_id = await resolve_object(tab, ref, signal);
    await call_on(tab, ref.session_id, object_id, scroll_container, [request.direction, request.amount], signal);
  } else if (request.direction === "start" || request.direction === "end") {
    const top = request.direction === "start" ? "0" : "document.documentElement.scrollHeight";
    await cdp(tab, "Runtime.evaluate", { expression: `window.scrollTo({top:${top},behavior:"instant"})` }, "", signal);
  } else {
    const view = await viewport(tab, signal);
    const step = request.amount === "page" ? Math.max(1, view.height * 0.85) : 320;
    const delta_y = request.direction === "up" ? -step : step;
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.max(1, view.width / 2), y: Math.max(1, view.height / 2), deltaX: 0, deltaY: delta_y }, "", signal);
  }
  invalidate_tab(tab, false);
};
