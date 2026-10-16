import type { RefLabel } from "../../../../../shared/git-view.ts";
import { TagIcon } from "../../../../components/icons.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_t, type Translate } from "../../../../i18n/index.ts";

const shown_labels = 2;

const label_tip = (t: Translate, label: RefLabel): string => {
  if (label.worktree !== null) return t("git.checked_out_in", { name: label.name, path: label.worktree });
  if (label.kind === "remote") return t("git.remote_ref", { name: label.name });
  if (label.kind === "head") return t("git.current_branch", { name: label.name });
  return label.name;
};

export const RefLabels = ({ labels }: { labels: RefLabel[] }) => {
  const t = use_t();
  const rest = labels.slice(shown_labels);
  return (
    <>
      {labels.slice(0, shown_labels).map((label) => (
        <Tooltip key={`${label.kind}:${label.name}`} label={label_tip(t, label)} placement="bottom-start">
          <span className="git-ref" data-kind={label.kind}>
            {label.kind === "tag" && <TagIcon size={12} />}
            <span>{label.name}</span>
          </span>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip label={rest.map((label) => label.name).join("\n")} placement="bottom-start">
          <span className="git-ref-more">+{rest.length}</span>
        </Tooltip>
      )}
    </>
  );
};
