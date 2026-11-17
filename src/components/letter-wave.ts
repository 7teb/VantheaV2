const cycle_ms = 4000;

const label_width_ms = 1000 / 1.75;

const edge_ms = 0.2 * label_width_ms;

const peak_ms = 0.1 * label_width_ms;

const dim = "var(--working-dim-opacity)";

export type WaveFrame = { opacity: number | string; offset: number };

export type WaveTiming = { duration: number; delay: number; iterations: number; easing: "linear" };

export const wave_frames = (): WaveFrame[] => [
  { opacity: dim, offset: 0 },
  { opacity: 1, offset: edge_ms / cycle_ms },
  { opacity: 1, offset: (edge_ms + peak_ms) / cycle_ms },
  { opacity: dim, offset: (2 * edge_ms + peak_ms) / cycle_ms },
  { opacity: dim, offset: 1 },
];

export const wave_timing = (letters: number, index: number): WaveTiming => ({
  duration: cycle_ms,
  delay: ((index + 0.5) / letters) * label_width_ms,
  iterations: Number.POSITIVE_INFINITY,
  easing: "linear",
});
