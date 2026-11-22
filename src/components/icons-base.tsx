import type { ReactNode, SVGProps } from "react";
import { class_names } from "./class-names.ts";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number; plain?: boolean };

export type IconComponent = (props: IconProps) => ReactNode;

export const Icon = ({
  size = 16,
  viewBox = "0 0 16 16",
  stroke = "currentColor",
  strokeWidth = 1,
  plain = false,
  className,
  children,
  ...rest
}: IconProps & { children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
    stroke={stroke}
    strokeWidth={strokeWidth}
    className={class_names(!plain && "icon", className)}
  >
    {children}
  </svg>
);

export const lucide = { viewBox: "0 0 24 24", strokeWidth: 1.75 } as const;

export const codicon = { fill: "currentColor", stroke: "none" } as const;

export const phosphor = { viewBox: "11 11 234 234", fill: "currentColor", stroke: "none" } as const;
