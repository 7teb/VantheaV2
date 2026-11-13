import type { ReactNode, SVGProps } from "react";
import { class_names } from "./class-names.ts";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number; plain?: boolean };

export type IconComponent = (props: IconProps) => ReactNode;

const outline_px = 0.5;

const view_width = (view_box: string) => Number(view_box.trim().split(/[\s,]+/)[2]);

export const Icon = ({
  size = 16,
  viewBox = "0 0 16 16",
  stroke = "currentColor",
  strokeWidth = 1,
  plain = false,
  className,
  children,
  ...rest
}: IconProps & { children: ReactNode }) => {
  const outline = plain ? 0 : (outline_px * view_width(viewBox)) / size;
  const filled = stroke === "none" && !plain;
  return (
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
      stroke={filled ? "currentColor" : stroke}
      strokeWidth={filled ? outline : Number(strokeWidth) + outline}
      className={class_names(!plain && "icon", className)}
    >
      {children}
    </svg>
  );
};

export const lucide = { viewBox: "0 0 24 24", strokeWidth: 1.75 } as const;

export const codicon = { fill: "currentColor", stroke: "none" } as const;

export const phosphor = { viewBox: "11 11 234 234", fill: "currentColor", stroke: "none" } as const;
