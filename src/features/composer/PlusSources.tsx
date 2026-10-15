import type { McpServerStatus, SkillEntry } from "../../../shared/ipc/extensions.ts";
import { BookOpenIcon, CheckIcon, PlugIcon, SettingsIcon } from "../../components/icons.tsx";
import { SkeletonRows } from "../../components/Skeleton.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { has_chip, type Draft, type DraftChip } from "../../state/chat-drafts.ts";
import type { Loaded } from "../../state/extensions.ts";
import { mcp_state_label } from "../settings/panes/McpServerCard.tsx";
import { MenuRow } from "./MenuRow.tsx";

export type SourceTab = "skills" | "mcp";

type SourceListProps = {
  tab: SourceTab;
  label_id: string;
  skills: Loaded<SkillEntry>;
  servers: Loaded<McpServerStatus>;
  draft: Draft;
  on_chip: (chip: DraftChip) => void;
  on_manage: (section: SourceTab) => void;
};

const notes: Record<SourceTab, { failed: MessageKey; empty: MessageKey; manage: MessageKey }> = {
  skills: { failed: "skills.load_failed", empty: "skills.empty", manage: "commands.manage_skills" },
  mcp: { failed: "mcp.load_failed", empty: "mcp.empty", manage: "commands.manage_mcp" },
};

export const usable_skills = (skills: Loaded<SkillEntry>) => skills.items.filter((skill) => skill.enabled && !skill.error);

const check = (checked: boolean) => <span className="composer-popover-check">{checked && <CheckIcon size={16} />}</span>;

export const SourceList = ({ tab, label_id, skills, servers, draft, on_chip, on_manage }: SourceListProps) => {
  const t = use_t();
  const loaded = tab === "skills" ? skills : servers;
  const rows =
    tab === "skills"
      ? usable_skills(skills).map((skill, index) => {
          const chip: DraftChip = { kind: "skill", name: skill.name };
          return (
            <MenuRow
              key={skill.slug}
              icon={BookOpenIcon}
              label={skill.name}
              hint={skill.description}
              trail={check(has_chip(draft, chip))}
              role="menuitemcheckbox"
              checked={has_chip(draft, chip)}
              index={index}
              on_select={() => on_chip(chip)}
            />
          );
        })
      : servers.items.map((server, index) => {
          const chip: DraftChip = { kind: "mcp", name: server.name };
          return (
            <MenuRow
              key={server.name}
              icon={PlugIcon}
              label={server.name}
              hint={mcp_state_label(t, server)}
              trail={check(has_chip(draft, chip))}
              role="menuitemcheckbox"
              checked={has_chip(draft, chip)}
              disabled={server.state !== "ready"}
              index={index}
              on_select={() => on_chip(chip)}
            />
          );
        });

  const notice = () => {
    if (loaded.status === "loading" && loaded.items.length === 0) {
      return <SkeletonRows widths={[46, 72, 58]} row_height={30} icon className="composer-popover-skeleton" />;
    }
    if (loaded.status === "failed") {
      return <p className="composer-popover-note">{t(notes[tab].failed)}</p>;
    }
    if (rows.length === 0) {
      return <p className="composer-popover-note">{t(notes[tab].empty)}</p>;
    }
    return null;
  };
  const shown_notice = notice();

  return (
    <>
      {shown_notice}
      <div role="menu" aria-labelledby={label_id}>
        {shown_notice === null && rows}
        <MenuRow icon={SettingsIcon} label={t(notes[tab].manage)} index={rows.length} on_select={() => on_manage(tab)} />
      </div>
    </>
  );
};
