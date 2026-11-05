import assert from "node:assert/strict";
import { before, test } from "node:test";
import { css_block, declarations, read } from "./css-kit.ts";
import { bundle, stub_components } from "./dom-kit.ts";

let room: any;

before(async () => {
  room = await bundle(['export { fit_popover, room_plan } from "./src/features/composer/popover-room.ts";'], [stub_components("popover-room.ts", {})]);
});

type Styles = Map<string, string>;

const style_of = (map: Styles) => ({
  setProperty: (name: string, value: string) => void map.set(name, value),
  removeProperty: (name: string) => void map.delete(name),
});

const px_var = (map: Styles, name: string) => (map.has(name) ? Number.parseFloat(map.get(name) ?? "") : Infinity);

type Scene = { area_top: number; composer_top: number; menu: number; cards: number[]; scrolled?: number[] };

const slot_gap = 8;

const scene = ({ area_top, composer_top, menu, cards, scrolled = [] }: Scene) => {
  const slot_styles: Styles = new Map();
  const node_styles: Styles = new Map();
  const card_cap = () => px_var(slot_styles, "--composer-card-cap");
  const boxes = cards.map((natural, index) => {
    let stored = scrolled[index] ?? 0;
    const height = () => Math.min(natural, card_cap());
    const clamp = () => {
      stored = Math.max(0, Math.min(stored, natural - height()));
    };
    return {
      get offsetHeight() {
        clamp();
        return height();
      },
      get scrollTop() {
        return stored;
      },
      set scrollTop(value: number) {
        stored = value;
        clamp();
      },
      querySelectorAll: () => [],
    };
  });
  const stack = () => boxes.reduce((sum, box) => sum + box.offsetHeight + slot_gap, 0);
  const node = {
    style: style_of(node_styles),
    get offsetHeight() {
      return Math.min(menu, 420, px_var(node_styles, "--composer-popover-room"));
    },
    closest: (selector: string) => (selector === ".main-area" ? { getBoundingClientRect: () => ({ top: area_top }) } : null),
  };
  const slot = {
    style: style_of(slot_styles),
    getBoundingClientRect: () => ({ top: composer_top - stack() }),
    querySelectorAll: (selector: string) => {
      assert.equal(selector, ":scope > :not(.composer)");
      return boxes;
    },
  };
  const composer = { getBoundingClientRect: () => ({ top: composer_top }) };
  const fit = () => room.fit_popover(node, slot, composer);
  const lift = () => px_var(slot_styles, "--composer-popover-lift");
  const lifted_top = () => composer_top - stack() - lift();
  const snapshot = () => ({ slot: Object.fromEntries(slot_styles), node: Object.fromEntries(node_styles), heights: boxes.map((box) => box.offsetHeight) });
  return { boxes, fit, lift, lifted_top, snapshot, slot_styles, node_styles, menu_height: () => node.offsetHeight };
};

test("a menu and cards that fit keep their natural heights and the cards lift by the menu height plus the gap", () => {
  const view = scene({ area_top: 0, composer_top: 800, menu: 300, cards: [120, 90] });
  view.fit();
  assert.equal(view.slot_styles.has("--composer-card-cap"), false);
  assert.equal(view.menu_height(), 300);
  assert.equal(view.lift(), 308);
  assert.deepEqual(
    view.boxes.map((box) => box.offsetHeight),
    [120, 90],
  );
  assert.ok(view.lifted_top() >= 8);
});

test("cards that would leave the main area get one cap and the lifted stack ends inside the main area", () => {
  const view = scene({ area_top: 40, composer_top: 640, menu: 300, cards: [240, 200, 40] });
  view.fit();
  const cap = px_var(view.slot_styles, "--composer-card-cap");
  assert.ok(Number.isFinite(cap));
  assert.equal(view.menu_height(), 300);
  assert.deepEqual(
    view.boxes.map((box) => box.offsetHeight),
    [cap, cap, 40],
  );
  assert.ok(view.lifted_top() >= 40 + 8, `lifted top ${view.lifted_top()}`);
  assert.ok(view.lifted_top() <= 40 + 8 + 2, `lifted top ${view.lifted_top()} wastes room`);
});

test("measuring again with the cap in place gives the same result instead of flipping between capped and uncapped", () => {
  const view = scene({ area_top: 0, composer_top: 600, menu: 260, cards: [260, 180] });
  view.fit();
  const first = view.snapshot();
  assert.ok(view.slot_styles.has("--composer-card-cap"));
  for (let round = 0; round < 3; round += 1) {
    view.fit();
    assert.deepEqual(view.snapshot(), first);
  }
});

test("a scrolled card keeps its scroll position across a measure", () => {
  const view = scene({ area_top: 0, composer_top: 600, menu: 260, cards: [400, 60], scrolled: [0, 0] });
  view.fit();
  const cap = px_var(view.slot_styles, "--composer-card-cap");
  view.boxes[0].scrollTop = 50;
  assert.equal(view.boxes[0].scrollTop, 50);
  view.fit();
  assert.equal(px_var(view.slot_styles, "--composer-card-cap"), cap);
  assert.equal(view.boxes[0].scrollTop, 50);
});

test("a long menu gets the room above the composer minus a minimum for each card", () => {
  const view = scene({ area_top: 0, composer_top: 420, menu: 420, cards: [200] });
  view.fit();
  assert.equal(view.menu_height(), 420 - 16 - 8 - 72);
  assert.equal(px_var(view.slot_styles, "--composer-card-cap"), 72);
  assert.ok(view.lifted_top() >= 8);
});

test("without cards the menu room is the whole space above the composer", () => {
  const view = scene({ area_top: 100, composer_top: 400, menu: 420, cards: [] });
  view.fit();
  assert.equal(view.menu_height(), 400 - 100 - 16);
  assert.equal(view.slot_styles.has("--composer-card-cap"), false);
  assert.equal(view.lifted_top(), 400 - (400 - 100 - 16) - 8);
});

test("room_plan shares the card room so small cards stay whole and the others split the rest", () => {
  assert.deepEqual(room.room_plan({ space: 1000, fixed: 24, menu: 300, cards: [100, 200, 300] }), { menu_room: 976 - 216, card_cap: null });
  assert.deepEqual(room.room_plan({ space: 600, fixed: 24, menu: 200, cards: [50, 300, 300] }), { menu_room: 576 - 194, card_cap: 163 });
  assert.deepEqual(room.room_plan({ space: 100, fixed: 24, menu: 300, cards: [300] }), { menu_room: 160, card_cap: 72 });
  assert.deepEqual(room.room_plan({ space: 500, fixed: 0, menu: 120, cards: [] }), { menu_room: 500, card_cap: null });
});

const queued_uncapped = (value: string, viewport: number, tuck: string): number => {
  const shape = /^min\(([\d.]+)dvh, calc\(var\(--composer-card-cap, ([\d.]+)dvh\) - ([\d.]+)px - var\(--tab-tuck\)\)\)$/.exec(value);
  assert.ok(shape, value);
  const dvh = (amount: string) => (Number(amount) * viewport) / 100;
  return Math.min(dvh(shape[1]), dvh(shape[2]) - Number(shape[3]) - Number.parseFloat(tuck));
};

test("the menu height follows the measured room and every lifted card honours the card cap", () => {
  const popover = declarations(css_block(read("features/composer/ComposerPopover.css"), ".composer-popover {"));
  assert.equal(popover["max-height"], "min(420px, var(--composer-popover-room, 420px))");
  const slot_css = read("features/composer/ComposerSlot.css");
  assert.equal(declarations(css_block(slot_css, ".composer-dock-card {"))["max-height"], "min(420px, 48vh, var(--composer-card-cap, 420px))");
  assert.equal(
    declarations(css_block(slot_css, ".composer-slot:has(.composer-dock-card ~ .composer-dock-card) .composer-dock-card {"))["max-height"],
    "min(420px, 24vh, var(--composer-card-cap, 420px))",
  );
  assert.equal(declarations(css_block(read("features/composer/TodosPanel.css"), ".todos-panel-body {"))["max-height"], "min(200px, calc(var(--composer-card-cap, 240px) - 40px))");
  const queued_css = read("features/composer/QueuedList.css");
  const queued_height = declarations(css_block(queued_css, ".queued-list {"))["max-height"];
  assert.equal(queued_height, "min(30dvh, calc(var(--composer-card-cap, 100dvh) - 1px - var(--tab-tuck)))");
  const tuck = declarations(css_block(read("features/composer/ComposerTab.css"), ".composer-tab {"))["--tab-tuck"];
  for (const viewport of [480, 720, 1080, 1440]) {
    assert.equal(queued_uncapped(queued_height, viewport, tuck), (viewport * 30) / 100, `uncapped queued list at a ${viewport}px viewport`);
  }
  const popover_tsx = read("features/composer/ComposerPopover.tsx");
  assert.match(popover_tsx, /const measure = \(\) => fit_popover\(node, slot, composer\);/);
  assert.match(popover_tsx, /observer\.observe\(node\);\s*observer\.observe\(slot\);/);
  assert.match(popover_tsx, /slot\.style\.removeProperty\("--composer-popover-lift"\);\s*slot\.style\.removeProperty\("--composer-card-cap"\);/);
});
