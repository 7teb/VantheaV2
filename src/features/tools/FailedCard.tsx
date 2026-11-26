import { CommandCard } from "./CommandCard.tsx";
import type { ErrorCard } from "./tool-body.ts";

export const FailedCard = ({ card }: { card: ErrorCard }) =>
  card.kind === "code" ? (
    <CommandCard shell={card.label} command={card.code} prompt={card.prompt} output={card.text} footer={null} wrap />
  ) : (
    <CommandCard shell={card.path} label_kind="path" command="" output={card.text} footer={null} wrap />
  );
