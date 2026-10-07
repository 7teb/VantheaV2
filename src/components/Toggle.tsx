import { class_names } from "./class-names.ts";
import "./Toggle.css";

type ToggleProps = {
  checked: boolean;
  on_change: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

export const Toggle = ({ checked, on_change, label, disabled = false, className }: ToggleProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className={class_names("toggle", className)}
    onClick={() => on_change(!checked)}
  >
    <span className="toggle-thumb" />
  </button>
);
