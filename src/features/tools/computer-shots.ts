import type { Message, StepImage, ToolStep } from "../../../shared/chat.ts";
import type { ComputerShotRef, ComputerView } from "../../../shared/tool-view.ts";

export type ShotMark = { x: number; y: number };

type ShotView = Extract<ComputerView, { action: "screenshot" }>;

const share = (value: number, size: number): number => Math.min(100, Math.max(0, (value / size) * 100));

const mark = (shot: ShotView, x: number, y: number): ShotMark => ({ x: share(x, shot.image_w), y: share(y, shot.image_h) });

export const computer_marks = (view: ComputerView, shot: ShotView): ShotMark[] => {
  switch (view.action) {
    case "click":
    case "move":
    case "scroll":
      return [mark(shot, view.x, view.y)];
    case "drag":
      return [mark(shot, view.x, view.y), mark(shot, view.to_x, view.to_y)];
    case "screenshot":
    case "type":
    case "key":
    case "wait":
      return [];
  }
};

const shot_ref = (view: ComputerView): ComputerShotRef | null => {
  switch (view.action) {
    case "click":
    case "move":
    case "scroll":
    case "drag":
      return view.shot ?? null;
    case "screenshot":
    case "type":
    case "key":
    case "wait":
      return null;
  }
};

type TakenShot = { image: StepImage; view: ShotView };

const taken_shot = (step: ToolStep): TakenShot | null => {
  const image = step.images?.[0];
  return image && step.view?.kind === "computer" && step.view.action === "screenshot" ? { image, view: step.view } : null;
};

export const referenced_shot = (messages: Message[], ref: ComputerShotRef): TakenShot | null => {
  const message = messages.find((entry) => entry.id === ref.message_id);
  if (message?.role !== "assistant") {
    return null;
  }
  const step = message.steps.find((entry) => entry.kind === "tool" && entry.call_id === ref.call_id);
  return step?.kind === "tool" ? taken_shot(step) : null;
};

export type ShotFrame = { image: StepImage; ratio: number; marks: ShotMark[] };

export const shot_frame = (messages: Message[], step: ToolStep, view: ComputerView): ShotFrame | null => {
  const ref = shot_ref(view);
  const shot = view.action === "screenshot" ? taken_shot(step) : ref ? referenced_shot(messages, ref) : null;
  return shot ? { image: shot.image, ratio: shot.view.image_w / shot.view.image_h, marks: computer_marks(view, shot.view) } : null;
};

export const shows_shot = (step: ToolStep, view: ComputerView): boolean =>
  view.action === "screenshot" ? taken_shot(step) !== null : shot_ref(view) !== null;
