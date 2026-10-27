import type { ReactNode } from "react";

type SidebarSectionProps = { label: string; action?: ReactNode; children: ReactNode };

export const SidebarSection = ({ label, action, children }: SidebarSectionProps) => (
  <section className="sidebar-section">
    <div className="sidebar-section-head">
      <span className="sidebar-section-label">{label}</span>
      {action && <span className="sidebar-section-actions">{action}</span>}
    </div>
    {children}
  </section>
);
