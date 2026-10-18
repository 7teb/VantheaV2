import { BookOpenIcon, ChartPieIcon, CloseIcon, PlugIcon, type IconComponent } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { Translate } from "../../i18n/translate.ts";
import type { DraftChip } from "../../state/chat-drafts.ts";
import { remove_draft_chip } from "../../state/composer.ts";

const chip_icons: Record<DraftChip["kind"], IconComponent> = { skill: BookOpenIcon, mcp: PlugIcon, visualize: ChartPieIcon };

const chip_text = (t: Translate, chip: DraftChip): { name: string; label: string } => {
  switch (chip.kind) {
    case "skill":
      return { name: chip.name, label: t("commands.skill_chip", { name: chip.name }) };
    case "mcp":
      return { name: chip.name, label: t("commands.mcp_chip", { name: chip.name }) };
    case "visualize": {
      const name = t("commands.visualize");
      return { name, label: name };
    }
  }
};

export const DraftChips = ({ draft_key, chips }: { draft_key: string; chips: DraftChip[] }) => {
  const t = use_t();
  return chips.map((chip) => {
    const Icon = chip_icons[chip.kind];
    const { name, label } = chip_text(t, chip);
    return (
      <button
        key={`${chip.kind}:${chip.name}`}
        type="button"
        className="composer-chip draft-chip"
        data-active
        data-kind={chip.kind}
        title={label}
        aria-label={t("composer.remove_attachment", { name })}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => remove_draft_chip(draft_key, chip)}
      >
        <span className="draft-chip-icon">
          <Icon size={15} />
          <CloseIcon size={15} />
        </span>
        <span className="composer-chip-label draft-chip-name">{name}</span>
      </button>
    );
  });
};
