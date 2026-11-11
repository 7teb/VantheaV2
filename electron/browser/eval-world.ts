import { cdp, type CdpFrameTree } from "./cdp.ts";
import { exception_text } from "./console-text.ts";
import type { EvaluateResponse } from "./evaluate.ts";
import type { BrowserTab } from "./state.ts";

const world_name = "vx-eval";

export const by_id_source = `(() => {
  const by_id = function getElementById(id) {
    const key = String(id);
    if (key === "") {
      return null;
    }
    for (const element of this.querySelectorAll("[id]")) {
      if (element.id === key) {
        return element;
      }
    }
    return null;
  };
  for (const prototype of [Document.prototype, DocumentFragment.prototype]) {
    Object.defineProperty(prototype, "getElementById", { value: by_id, writable: true, enumerable: true, configurable: true });
  }
})()`;

type FrameTreeResponse = { frameTree?: CdpFrameTree };

type IsolatedWorldResponse = { executionContextId?: number };

export const ensure_eval_world = async (tab: BrowserTab, signal: AbortSignal): Promise<number> => {
  const tree = await cdp<FrameTreeResponse>(tab, "Page.getFrameTree", {}, "", signal);
  const frame_id = tree.frameTree?.frame?.id;
  if (!frame_id) {
    throw new Error("The tab has no main frame.");
  }

  const world = await cdp<IsolatedWorldResponse>(tab, "Page.createIsolatedWorld", { frameId: frame_id, worldName: world_name }, "", signal);
  if (typeof world.executionContextId !== "number") {
    throw new Error("Page.createIsolatedWorld returned no execution context.");
  }

  const prepared = await cdp<EvaluateResponse>(
    tab,
    "Runtime.evaluate",
    { expression: by_id_source, contextId: world.executionContextId, silent: true, returnByValue: true },
    "",
    signal,
  );
  if (prepared.exceptionDetails !== undefined) {
    throw new Error(`Preparing the isolated context failed: ${exception_text(prepared.exceptionDetails)}`);
  }

  return world.executionContextId;
};
