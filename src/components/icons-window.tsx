import type { ReactNode } from "react";

type GlyphProps = { size?: number };

const Glyph = ({ size = 10, crisp, children }: GlyphProps & { crisp: boolean; children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth={1}
    shapeRendering={crisp ? "crispEdges" : "geometricPrecision"}
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const MinimizeGlyph = (props: GlyphProps) => (
  <Glyph crisp {...props}>
    <path d="M0 5.5h10" />
  </Glyph>
);

export const MaximizeGlyph = (props: GlyphProps) => (
  <Glyph crisp {...props}>
    <rect x="0.5" y="0.5" width="9" height="9" />
  </Glyph>
);

export const RestoreGlyph = (props: GlyphProps) => (
  <Glyph crisp {...props}>
    <rect x="0.5" y="2.5" width="7" height="7" />
    <path d="M2.5 2.5v-2h7v7h-2" />
  </Glyph>
);

export const CloseGlyph = (props: GlyphProps) => (
  <Glyph crisp={false} {...props}>
    <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
  </Glyph>
);
