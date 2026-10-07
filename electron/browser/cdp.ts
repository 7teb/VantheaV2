import { error_text, invalidate_tab, notify_tab, settle_within, type BrowserTab, type CdpSession, type FrameInfo } from "./state.ts";

const cdp_timeout_ms = 30000;

const target_domains = ["Page.enable", "DOM.enable", "Runtime.enable", "Accessibility.enable"];

const auto_attach = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };

export type CdpFrameTree = { frame?: { id?: string; parentId?: string; url?: string }; childFrames?: CdpFrameTree[] };

export const cdp = <T>(tab: BrowserTab, method: string, params: Record<string, unknown>, session_id: string, signal: AbortSignal): Promise<T> =>
  settle_within<T>(tab.guest.debugger.sendCommand(method, params, session_id || undefined), signal, cdp_timeout_ms, `Browser call ${method}`);

export const evaluate_value = <T>(result: { result?: { value?: unknown } } | undefined): T | undefined => result?.result?.value as T | undefined;

export type CallResult = {
  result?: { value?: unknown; objectId?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
};

const call_function = async (tab: BrowserTab, session_id: string, object_id: string, declaration: string, args: unknown[], by_value: boolean, signal: AbortSignal) => {
  const response = await cdp<CallResult>(
    tab,
    "Runtime.callFunctionOn",
    { objectId: object_id, functionDeclaration: declaration, arguments: args.map((value) => ({ value })), returnByValue: by_value, awaitPromise: true, userGesture: true },
    session_id,
    signal,
  );
  if (response.exceptionDetails) {
    const details = response.exceptionDetails;
    throw new Error(`Page script failed: ${(details.exception?.description ?? details.text ?? "unknown error").slice(0, 300)}`);
  }
  return response;
};

export const call_on = (tab: BrowserTab, session_id: string, object_id: string, declaration: string, args: unknown[], signal: AbortSignal) =>
  call_function(tab, session_id, object_id, declaration, args, true, signal);

export const call_for_object = async (tab: BrowserTab, session_id: string, object_id: string, declaration: string, args: unknown[], signal: AbortSignal) =>
  (await call_function(tab, session_id, object_id, declaration, args, false, signal)).result?.objectId ?? null;

const enable_session = async (tab: BrowserTab, session_id: string, signal: AbortSignal) => {
  await Promise.all([
    ...target_domains.map((method) => cdp(tab, method, {}, session_id, signal)),
    cdp(tab, "Target.setAutoAttach", auto_attach, session_id, signal),
  ]);
};

export const ensure_debugger = async (tab: BrowserTab, signal: AbortSignal) => {
  signal.throwIfAborted();
  if (tab.debugger_attached && tab.guest.debugger.isAttached()) {
    return;
  }
  try {
    if (!tab.guest.debugger.isAttached()) {
      tab.guest.debugger.attach("1.3");
    }
    await enable_session(tab, "", signal);
    tab.debugger_attached = true;
  } catch (error) {
    tab.debugger_attached = false;
    if (signal.aborted) {
      throw error;
    }
    throw new Error(`Could not attach to browser tab ${tab.tab_id}: ${error_text(error)}`);
  }
};

const track_session = async (tab: BrowserTab, params: Record<string, unknown>) => {
  const session_id = String(params.sessionId ?? "");
  const info = (params.targetInfo ?? {}) as Record<string, unknown>;
  tab.sessions.set(session_id, {
    session_id,
    target_id: String(info.targetId ?? ""),
    parent_frame_id: String(info.parentFrameId ?? ""),
    type: String(info.type ?? ""),
    url: String(info.url ?? ""),
  });
  const controller = new AbortController();
  try {
    await enable_session(tab, session_id, controller.signal);
  } catch (error) {
    console.warn(`[browser] enabling child target ${session_id} of tab ${tab.tab_id} failed: ${error_text(error)}`);
  }
  notify_tab(tab);
};

export const handle_debugger_message = (tab: BrowserTab, method: string, params: Record<string, unknown>, session_id: string) => {
  if (method === "Target.attachedToTarget" && params.sessionId) {
    void track_session(tab, params);
    return;
  }
  if (method === "Target.detachedFromTarget" && params.sessionId) {
    tab.sessions.delete(String(params.sessionId));
    invalidate_tab(tab, true);
    return;
  }
  if (method === "DOM.documentUpdated" || method === "Page.frameDetached") {
    invalidate_tab(tab, true);
    return;
  }
  if (method === "Page.frameNavigated") {
    const frame = (params.frame ?? {}) as { parentId?: string };
    invalidate_tab(tab, !frame.parentId);
    return;
  }
  if (method === "Accessibility.loadComplete" || method === "Accessibility.nodesUpdated") {
    notify_tab(tab);
  }
  if (session_id && !tab.sessions.has(session_id)) {
    tab.sessions.set(session_id, { session_id, target_id: "", parent_frame_id: "", type: "", url: "" });
  }
};

export const collect_frame_tree = (tree: CdpFrameTree | undefined, session_id: string): Map<string, FrameInfo> => {
  const frames = new Map<string, FrameInfo>();
  const visit = (entry: CdpFrameTree | undefined, parent_id: string) => {
    const frame = entry?.frame;
    if (!frame?.id) {
      return;
    }
    frames.set(frame.id, { frame_id: frame.id, parent_id: frame.parentId || parent_id, url: String(frame.url ?? ""), session_id });
    for (const child of entry?.childFrames ?? []) {
      visit(child, frame.id);
    }
  };
  visit(tree, "");
  return frames;
};

export const frame_depth = (frame_id: string, frames: Map<string, FrameInfo>) => {
  let depth = 0;
  let current = frames.get(frame_id);
  const seen = new Set<string>();
  while (current?.parent_id && !seen.has(current.parent_id)) {
    seen.add(current.parent_id);
    depth += 1;
    current = frames.get(current.parent_id);
  }
  return depth;
};

export const frame_session = (frame_id: string, frames: Map<string, FrameInfo>, sessions: Map<string, CdpSession>) => {
  let current = frames.get(frame_id);
  const seen = new Set<string>();
  while (current && !seen.has(current.frame_id)) {
    seen.add(current.frame_id);
    if (current.session_id) {
      return current.session_id;
    }
    const frame_id_now = current.frame_id;
    const direct = [...sessions.values()].find((entry) => entry.target_id === frame_id_now);
    if (direct) {
      return direct.session_id;
    }
    current = frames.get(current.parent_id);
  }
  return "";
};

const merge_child_frames = (frames: Map<string, FrameInfo>, child_frames: Map<string, FrameInfo>, session: CdpSession) => {
  for (const [frame_id, frame] of child_frames) {
    const known = frames.get(frame_id);
    frames.set(frame_id, { ...frame, parent_id: frame.parent_id || known?.parent_id || session.parent_frame_id, session_id: session.session_id });
  }
};

export const read_frames = async (tab: BrowserTab, signal: AbortSignal): Promise<Map<string, FrameInfo>> => {
  await ensure_debugger(tab, signal);
  const root = await cdp<{ frameTree?: CdpFrameTree }>(tab, "Page.getFrameTree", {}, "", signal);
  const frames = collect_frame_tree(root.frameTree, "");
  for (const session of tab.sessions.values()) {
    if (session.type && session.type !== "iframe" && session.type !== "page") {
      continue;
    }
    try {
      const child = await cdp<{ frameTree?: CdpFrameTree }>(tab, "Page.getFrameTree", {}, session.session_id, signal);
      merge_child_frames(frames, collect_frame_tree(child.frameTree, session.session_id), session);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      console.warn(`[browser] frame tree of target ${session.session_id} (${session.url}) failed: ${error_text(error)}`);
    }
    if (session.target_id && !frames.has(session.target_id)) {
      frames.set(session.target_id, { frame_id: session.target_id, parent_id: session.parent_frame_id, url: session.url, session_id: session.session_id });
    }
  }
  return frames;
};
