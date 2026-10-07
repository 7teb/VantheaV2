import { read_ax_node, type AxNode } from "./ax.ts";
import { cdp, evaluate_value, frame_session, read_frames } from "./cdp.ts";
import { error_text, pause, tab_url, type BrowserTab, type FrameInfo } from "./state.ts";

export type WaitCondition = "load" | "url_contains" | "text" | "element";

const max_wait_ms = 120000;

const frame_tree_matches = async (tab: BrowserTab, frame: FrameInfo, session_id: string, match: (node: AxNode) => boolean, signal: AbortSignal) => {
  try {
    const tree = await cdp<{ nodes?: AxNode[] }>(tab, "Accessibility.getFullAXTree", { frameId: frame.frame_id }, session_id, signal);
    return (tree.nodes ?? []).some(match);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    console.warn(`[browser] wait: accessibility tree of frame ${frame.frame_id} failed: ${error_text(error)}`);
    return false;
  }
};

const frame_text_matches = async (tab: BrowserTab, session_id: string, value: string, signal: AbortSignal) => {
  try {
    const result = await cdp<{ result?: { value?: unknown } }>(
      tab,
      "Runtime.evaluate",
      { expression: `Boolean(document.body&&document.body.innerText.includes(${JSON.stringify(value)}))`, returnByValue: true },
      session_id,
      signal,
    );
    return evaluate_value<boolean>(result) === true;
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    console.warn(`[browser] wait: text probe in session ${session_id || "root"} failed: ${error_text(error)}`);
    return false;
  }
};

const node_has_text = (value: string) => (node: AxNode) => {
  const entry = read_ax_node(node);
  return entry.name.includes(value) || entry.value.includes(value) || entry.description.includes(value);
};

const node_has_name = (value: string) => (node: AxNode) => read_ax_node(node).name.includes(value);

const condition_met = async (tab: BrowserTab, condition: WaitCondition, value: string, signal: AbortSignal) => {
  if (condition === "load") {
    return !tab.loading;
  }
  if (condition === "url_contains") {
    return tab_url(tab).includes(value);
  }
  const frames = await read_frames(tab, signal);
  for (const frame of frames.values()) {
    const session_id = frame_session(frame.frame_id, frames, tab.sessions);
    if (condition === "text" && (await frame_text_matches(tab, session_id, value, signal))) {
      return true;
    }
    if (await frame_tree_matches(tab, frame, session_id, condition === "text" ? node_has_text(value) : node_has_name(value), signal)) {
      return true;
    }
  }
  return false;
};

export const wait_for = async (tab: BrowserTab, condition: WaitCondition, value: string, timeout_ms: number | null, signal: AbortSignal) => {
  const timeout = Math.max(100, Math.min(max_wait_ms, timeout_ms ?? 10000));
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await condition_met(tab, condition, value, signal)) {
      return Date.now() - started;
    }
    await pause(tab, 250, signal);
  }
  throw new Error(`browser_wait timed out after ${timeout} ms.`);
};
