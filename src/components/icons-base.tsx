import type { ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

export type IconComponent = (props: IconProps) => ReactNode;

export const Icon = ({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export const codicon = { viewBox: "0 0 16 16", fill: "currentColor", strokeWidth: 0.15 } as const;

export const phosphor = { viewBox: "11 11 234 234", fill: "currentColor", strokeWidth: 0.64 } as const;
