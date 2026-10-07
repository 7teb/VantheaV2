import type { ReactNode } from "react";
import { class_names } from "../../components/class-names.ts";
import "./SettingsLayout.css";

type SettingsGroupProps = { label?: string; children: ReactNode };

export const SettingsGroup = ({ label, children }: SettingsGroupProps) => (
  <section className="settings-group">
    {label && <div className="settings-group-label section-label">{label}</div>}
    <div className="settings-group-body inset-surface">{children}</div>
  </section>
);

type SettingsRowProps = {
  label: string;
  hint?: string;
  error?: string | null;
  stacked?: boolean;
  children: ReactNode;
};

export const SettingsRow = ({ label, hint, error, stacked = false, children }: SettingsRowProps) => (
  <div className={class_names("settings-row", stacked && "is-stacked", error && "has-error")}>
    <div className="settings-row-text">
      <div className="settings-row-label">{label}</div>
      {hint && <div className="settings-row-hint">{hint}</div>}
    </div>
    <div className="settings-row-control">{children}</div>
    {error && (
      <div className="settings-row-error" role="alert">
        {error}
      </div>
    )}
  </div>
);
