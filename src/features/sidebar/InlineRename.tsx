import { useRef, useState } from "react";

type InlineRenameProps = { initial: string; label: string; on_done: (value: string | null) => void };

export const InlineRename = ({ initial, label, on_done }: InlineRenameProps) => {
  const [draft, set_draft] = useState(initial);
  const finished = useRef(false);

  const finish = (save: boolean) => {
    if (finished.current) {
      return;
    }
    finished.current = true;
    const value = draft.trim();
    on_done(save && value !== "" && value !== initial ? value : null);
  };

  return (
    <input
      className="inline-rename"
      value={draft}
      aria-label={label}
      autoFocus
      spellCheck={false}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => set_draft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          finish(event.key === "Enter");
        }
      }}
    />
  );
};
