import type { ReactNode } from "react";
import { IconButton } from "../../components/Button.tsx";
import { class_names } from "../../components/class-names.ts";
import { CloseIcon } from "../../components/icons.tsx";
import { close_dock } from "../../state/ui.ts";
import "./DockPanel.css";

type DockPanelProps = {
  title: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  close_label: string;
  className?: string;
  children: ReactNode;
};

export const DockPanel = ({ title, actions, toolbar, close_label, className, children }: DockPanelProps) => (
  <section className={class_names("dock-panel", className)}>
    <header className="dock-header">
      <div className="dock-header-main">{title}</div>
      <div className="dock-header-actions">
        {actions}
        <IconButton label={close_label} onClick={close_dock}>
          <CloseIcon size={16} />
        </IconButton>
      </div>
    </header>
    {toolbar}
    <div className="dock-body">{children}</div>
  </section>
);

type DockTitleProps = { label: string; meta?: string };

export const DockTitle = ({ label, meta }: DockTitleProps) => (
  <h2 className="dock-title">
    <span>{label}</span>
    {meta && <span className="dock-title-meta">{meta}</span>}
  </h2>
);

type DockEmptyProps = { text: string };

export const DockEmpty = ({ text }: DockEmptyProps) => <p className="dock-empty">{text}</p>;
