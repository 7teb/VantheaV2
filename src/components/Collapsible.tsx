import { useId, useState, type ReactNode } from "react";
import { class_names } from "./class-names.ts";
import { ChevronRightIcon } from "./icons.tsx";
import "./Collapsible.css";

type CollapsibleBodyProps = { open: boolean; id?: string; className?: string; children: ReactNode };

export const CollapsibleBody = ({ open, id, className, children }: CollapsibleBodyProps) => (
  <div id={id} className={class_names("collapsible-body", className)} data-open={open} inert={!open}>
    <div className="collapsible-clip">{children}</div>
  </div>
);

type CollapsibleProps = {
  header: ReactNode;
  open?: boolean;
  default_open?: boolean;
  on_toggle?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
};

export const Collapsible = ({ header, open, default_open = false, on_toggle, className, children }: CollapsibleProps) => {
  const body_id = useId();
  const [own_open, set_own_open] = useState(default_open);
  const expanded = open ?? own_open;

  const toggle = () => {
    set_own_open(!expanded);
    on_toggle?.(!expanded);
  };

  return (
    <div className={class_names("collapsible", className)} data-open={expanded}>
      <button type="button" className="collapsible-header" aria-expanded={expanded} aria-controls={body_id} onClick={toggle}>
        <ChevronRightIcon size={14} className="collapsible-chevron" />
        <span className="collapsible-title">{header}</span>
      </button>
      <CollapsibleBody open={expanded} id={body_id}>
        {children}
      </CollapsibleBody>
    </div>
  );
};
