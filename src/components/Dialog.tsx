import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button.tsx";
import { class_names } from "./class-names.ts";
import { focusable_within, trap_tab, use_focus_return, use_layer, use_presence } from "./use-layer.ts";
import "./Dialog.css";

type DialogProps = {
  open: boolean;
  on_close: () => void;
  label: string;
  className?: string;
  backdrop_className?: string;
  initial_focus?: "first" | "panel";
  children: ReactNode;
};

export const Dialog = ({ open, on_close, label, className, backdrop_className, initial_focus = "first", children }: DialogProps) => {
  const presence = use_presence(open);
  const panel = useRef<HTMLDivElement>(null);
  use_layer(open, on_close);
  use_focus_return(open);

  useEffect(() => {
    const node = panel.current;
    if (!open || !node) {
      return;
    }
    const target = initial_focus === "first" ? (focusable_within(node)[0] ?? node) : node;
    target.focus({ preventScroll: true });
  }, [open, initial_focus, presence.mounted]);

  if (!presence.mounted) {
    return null;
  }

  return createPortal(
    <div
      className={class_names("dialog-backdrop", backdrop_className)}
      data-state={presence.state}
      onAnimationEnd={presence.on_animation_end}
      onPointerDown={(event) => {
        if (open && event.target === event.currentTarget) {
          on_close();
        }
      }}
    >
      <div
        ref={panel}
        className={class_names("dialog-panel", className)}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => trap_tab(event.currentTarget, event)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  detail?: string;
  confirm_label: string;
  cancel_label: string;
  danger?: boolean;
  on_confirm: () => void;
  on_close: () => void;
};

export const ConfirmDialog = ({ open, title, detail, confirm_label, cancel_label, danger = false, on_confirm, on_close }: ConfirmDialogProps) => (
  <Dialog open={open} on_close={on_close} label={title} className="confirm-dialog">
    <h2 className="confirm-title">{title}</h2>
    {detail && <p className="confirm-detail">{detail}</p>}
    <div className="confirm-actions">
      <Button variant="ghost" onClick={on_close}>
        {cancel_label}
      </Button>
      <Button
        variant={danger ? "danger" : "secondary"}
        onClick={() => {
          on_close();
          on_confirm();
        }}
      >
        {confirm_label}
      </Button>
    </div>
  </Dialog>
);
