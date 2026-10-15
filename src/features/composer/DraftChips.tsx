import { BookOpenIcon, CloseIcon, PlugIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { DraftChip } from "../../state/chat-drafts.ts";
import { remove_draft_chip } from "../../state/composer.ts";

export const DraftChips = ({ draft_key, chips }: { draft_key: string; chips: DraftChip[] }) => {
  const t = use_t();
  if (chips.length === 0) {
    return null;
  }
  return (
    <ul className="draft-chips" aria-label={t("commands.added")}>
      {chips.map((chip) => {
        const Icon = chip.kind === "skill" ? BookOpenIcon : PlugIcon;
        const label = t(chip.kind === "skill" ? "commands.skill_chip" : "commands.mcp_chip", { name: chip.name });
        return (
          <li key={`${chip.kind}:${chip.name}`} className="draft-chip" data-kind={chip.kind} aria-label={label}>
            <Icon size={14} />
            <span className="draft-chip-name">{chip.name}</span>
            <button
              type="button"
              className="draft-chip-remove"
              aria-label={t("composer.remove_attachment", { name: chip.name })}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => remove_draft_chip(draft_key, chip)}
            >
              <CloseIcon size={12} />
            </button>
          </li>
        );
      })}
    </ul>
  );
};
