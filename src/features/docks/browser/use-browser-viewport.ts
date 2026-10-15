import { useEffect, useState, type RefObject } from "react";
import type { BrowserRect } from "../../../../shared/ipc/browser.ts";
import { freeze_browser, send_browser_viewport } from "../../../state/browser.ts";
import { ui_store } from "../../../state/ui.ts";
import { covered_by, has_area, rect_of, same_rect } from "./viewport-geometry.ts";

const sample_points = [0.02, 0.5, 0.98];

const settle_frames = 2;

const portal_rects = (): BrowserRect[] => {
  const root = document.getElementById("root");
  return [...document.body.children].flatMap((child) => (child === root || !(child instanceof HTMLElement) ? [] : [rect_of(child.getBoundingClientRect())]));
};

const hidden_by_page = (node: HTMLElement, rect: BrowserRect) =>
  sample_points.some((fx) =>
    sample_points.some((fy) => {
      const hit = document.elementFromPoint(rect.x + rect.width * fx, rect.y + rect.height * fy);
      return hit !== null && !node.contains(hit) && !hit.contains(node);
    }),
  );

const after_frames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left === 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });

const decoded = async (url: string) => {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    console.warn("[browser] decoding the frozen page frame failed", error);
  }
};

export const use_browser_viewport = (element: RefObject<HTMLDivElement | null>, chat_key: string, live: boolean): string | null => {
  const [frame, set_frame] = useState<string | null>(null);

  useEffect(() => {
    const node = element.current;
    if (!node || !live) {
      return;
    }
    let disposed = false;
    let sent: BrowserRect | null = null;
    let covered = false;
    let generation = 0;
    let loop = 0;
    let measured: BrowserRect | null = null;
    const radius = () => Number.parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
    const send = (rect: BrowserRect | null) => {
      if (same_rect(rect, sent)) {
        return;
      }
      sent = rect;
      send_browser_viewport({ chat_id: chat_key, rect, radius: radius() });
    };
    const freeze = async () => {
      const mine = ++generation;
      const url = await freeze_browser(chat_key);
      if (url) {
        await decoded(url);
      }
      if (disposed || mine !== generation) {
        return;
      }
      set_frame(url);
      await after_frames(settle_frames);
      if (!disposed && mine === generation) {
        send(null);
      }
    };
    const thaw = async (rect: BrowserRect) => {
      const mine = ++generation;
      send(rect);
      await after_frames(settle_frames);
      if (!disposed && mine === generation) {
        set_frame(null);
      }
    };
    const update = (rect: BrowserRect) => {
      if (!has_area(rect)) {
        covered = false;
        generation += 1;
        send(null);
        return;
      }
      const now_covered = covered_by(rect, portal_rects()) || hidden_by_page(node, rect);
      if (now_covered && !covered) {
        covered = true;
        void freeze();
        return;
      }
      if (now_covered) {
        return;
      }
      if (covered || sent === null) {
        covered = false;
        void thaw(rect);
        return;
      }
      send(rect);
    };
    const tick = () => {
      loop = 0;
      const rect = rect_of(node.getBoundingClientRect());
      const moved = !same_rect(rect, measured);
      measured = rect;
      update(rect);
      if (moved || portal_rects().some(has_area)) {
        loop = requestAnimationFrame(tick);
      }
    };
    const schedule = () => {
      if (!loop) {
        loop = requestAnimationFrame(tick);
      }
    };
    const resize = new ResizeObserver(schedule);
    const portals = new MutationObserver(schedule);
    resize.observe(node);
    portals.observe(document.body, { childList: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("transitionrun", schedule, true);
    document.addEventListener("transitionend", schedule, true);
    const stop_ui = ui_store.subscribe(schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(loop);
      resize.disconnect();
      portals.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("transitionrun", schedule, true);
      document.removeEventListener("transitionend", schedule, true);
      stop_ui();
      send_browser_viewport({ chat_id: chat_key, rect: null, radius: 0 });
      set_frame(null);
    };
  }, [element, chat_key, live]);

  return frame;
};
