import type { CSSProperties, ReactNode } from "react";
import type { IconComponent } from "../../components/icons.tsx";

type MenuRowProps = {
  icon: IconComponent | null;
  label: ReactNode;
  hint?: string | null;
  trail?: ReactNode;
  disabled?: boolean;
  active?: boolean;
  index?: number;
  id?: string;
  role?: "option" | "menuitem" | "menuitemcheckbox";
  checked?: boolean;
  on_select: () => void;
  on_hover?: () => void;
};

export const MenuRow = ({ icon: Icon, label, hint, trail, disabled = false, active = false, index = 0, id, role = "menuitem", checked, on_select, on_hover }: MenuRowProps) => (
  <button
    id={id}
    type="button"
    role={role}
    aria-selected={role === "option" ? active : undefined}
    aria-checked={role === "menuitemcheckbox" ? checked : undefined}
    tabIndex={-1}
    disabled={disabled}
    className="composer-popover-row"
    data-active={active}
    style={{ "--row": Math.min(index, 8) } as CSSProperties}
    onClick={on_select}
    onMouseMove={on_hover}
  >
    <span className="composer-popover-icon">{Icon && <Icon size={16} />}</span>
    <span className="composer-popover-name">{label}</span>
    {hint && <span className="composer-popover-hint">{hint}</span>}
    {trail && <span className="composer-popover-trail">{trail}</span>}
  </button>
);
