const min_card_px = 72;

const min_menu_px = 160;

const lift_gap = 8;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const card_cap = (heights: number[], room: number): number | null => {
  if (heights.length === 0 || sum(heights) <= room) {
    return null;
  }
  const sorted = [...heights].sort((left, right) => left - right);
  let left = room;
  let index = 0;
  while (index < sorted.length - 1 && sorted[index] <= left / (sorted.length - index)) {
    left -= sorted[index];
    index += 1;
  }
  return Math.max(min_card_px, Math.floor(left / (sorted.length - index)));
};

export type RoomInput = { space: number; fixed: number; menu: number; cards: number[] };

export type RoomPlan = { menu_room: number; card_cap: number | null };

export const room_plan = ({ space, fixed, menu, cards }: RoomInput): RoomPlan => {
  const budget = space - fixed;
  const reserve = sum(cards.map((height) => Math.min(height, min_card_px)));
  const menu_room = Math.max(min_menu_px, Math.floor(budget - reserve));
  return { menu_room, card_cap: card_cap(cards, budget - Math.min(menu, menu_room)) };
};

const scrolled_boxes = (cards: HTMLElement[]) =>
  cards
    .flatMap((card) => [card, ...card.querySelectorAll<HTMLElement>("*")])
    .filter((box) => box.scrollTop > 0)
    .map((box) => ({ box, scroll_top: box.scrollTop }));

export const fit_popover = (node: HTMLElement, slot: HTMLElement, composer: HTMLElement) => {
  const cards = [...slot.querySelectorAll<HTMLElement>(":scope > :not(.composer)")];
  const scrolled = scrolled_boxes(cards);
  slot.style.removeProperty("--composer-card-cap");
  node.style.removeProperty("--composer-popover-room");
  const top = composer.getBoundingClientRect().top;
  const area_top = node.closest(".main-area")?.getBoundingClientRect().top ?? 0;
  const heights = cards.map((card) => card.offsetHeight);
  const plan = room_plan({
    space: top - area_top - lift_gap * 2,
    fixed: top - slot.getBoundingClientRect().top - sum(heights),
    menu: node.offsetHeight,
    cards: heights,
  });
  node.style.setProperty("--composer-popover-room", `${plan.menu_room}px`);
  if (plan.card_cap !== null) {
    slot.style.setProperty("--composer-card-cap", `${plan.card_cap}px`);
  }
  slot.style.setProperty("--composer-popover-lift", `${node.offsetHeight + lift_gap}px`);
  for (const { box, scroll_top } of scrolled) {
    box.scrollTop = scroll_top;
  }
};
