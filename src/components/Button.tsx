import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { class_names } from "./class-names.ts";
import { Tooltip } from "./Tooltip.tsx";
import "./Button.css";

export type ButtonVariant = "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export const Button = ({ variant = "secondary", icon, className, children, type = "button", ...rest }: ButtonProps) => (
  <button type={type} className={class_names("button", `button-${variant}`, className)} {...rest}>
    {icon}
    {children !== undefined && <span className="button-label">{children}</span>}
  </button>
);

type PrimaryButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  icon: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export const PrimaryButton = ({ label, icon, className, type = "button", ...rest }: PrimaryButtonProps) => (
  <button type={type} aria-label={label} className={class_names("button-primary", className)} {...rest}>
    {icon}
  </button>
);

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  hint?: string;
  active?: boolean;
  size?: "sm" | "md";
  tooltip?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export const IconButton = ({ label, hint, active = false, size = "md", tooltip = true, className, type = "button", children, ...rest }: IconButtonProps) => {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={class_names("icon-button", `icon-button-${size}`, active && "is-active", className)}
      {...rest}
    >
      {children}
    </button>
  );
  if (!tooltip) {
    return button;
  }
  return (
    <Tooltip label={label} hint={hint}>
      {button}
    </Tooltip>
  );
};
