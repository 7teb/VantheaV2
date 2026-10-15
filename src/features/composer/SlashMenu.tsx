import { useLayoutEffect, useRef } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "../../components/icons.tsx";
import { ToggleTrack } from "../../components/Toggle.tsx";
import { use_t } from "../../i18n/index.ts";
import { label_parts } from "./command-menu.ts";
import { ComposerPopover } from "./ComposerPopover.tsx";
import { MenuRow } from "./MenuRow.tsx";
import type { SlashItem, SlashMenu as SlashMenuState } from "./use-slash-menu.ts";

export const slash_option_id = (list_id: string, item_id: string) => `${list_id}-${item_id}`;

type Shown = Pick<SlashMenuState, "items" | "active" | "parent" | "query">;

const Label = ({ label, query }: { label: string; query: string }) => {
  const parts = label_parts(label, query);
  return (
    <>
      {parts.before}
      {parts.match && <mark className="composer-popover-match">{parts.match}</mark>}
      {parts.after}
    </>
  );
};

const icon_of = (item: SlashItem) => {
  if (item.checked === null) {
    return item.icon;
  }
  return item.checked ? CheckIcon : null;
};

const trail_of = (item: SlashItem) => {
  if (item.toggled !== null) {
    return <ToggleTrack checked={item.toggled} />;
  }
  if (item.submenu) {
    return <ChevronRightIcon size={14} />;
  }
  return null;
};

type SlashMenuProps = { slash: SlashMenuState; keep: (target: Node) => boolean; list_id: string };

export const SlashMenu = ({ slash, keep, list_id }: SlashMenuProps) => {
  const t = use_t();
  const list = useRef<HTMLDivElement>(null);
  const last_open = useRef<Shown>(slash);
  if (slash.open) {
    last_open.current = slash;
  }
  const shown = last_open.current;

  useLayoutEffect(() => {
    const node = list.current;
    const row = node?.querySelector<HTMLElement>('[data-active="true"]');
    if (!node || !row) {
      return;
    }
    if (row.offsetTop < node.scrollTop) {
      node.scrollTop = row.offsetTop;
      return;
    }
    const bottom = row.offsetTop + row.offsetHeight;
    if (bottom > node.scrollTop + node.clientHeight) {
      node.scrollTop = bottom - node.clientHeight;
    }
  }, [shown.active, shown.parent]);

  return (
    <ComposerPopover open={slash.open} label={t("commands.menu")} focus="input" keep={keep} on_close={slash.close}>
      {shown.parent === null ? (
        <div className="composer-popover-label">{t("commands.menu")}</div>
      ) : (
        <button type="button" className="composer-popover-label composer-popover-back" tabIndex={-1} aria-label={t("commands.back")} onClick={slash.back}>
          <ChevronLeftIcon size={14} />
          <span>{shown.parent}</span>
        </button>
      )}
      <div ref={list} key={shown.parent ?? ""} className="composer-popover-list" role="listbox" id={list_id} aria-label={shown.parent ?? t("commands.menu")}>
        {shown.items.map((item, index) => (
          <MenuRow
            key={item.id}
            id={slash_option_id(list_id, item.id)}
            role="option"
            icon={icon_of(item)}
            label={<Label label={item.label} query={shown.parent === null ? shown.query : ""} />}
            hint={item.hint}
            trail={trail_of(item)}
            disabled={item.disabled}
            active={index === shown.active}
            index={index}
            on_select={() => slash.select(index)}
            on_hover={() => slash.hover(index)}
          />
        ))}
      </div>
    </ComposerPopover>
  );
};
