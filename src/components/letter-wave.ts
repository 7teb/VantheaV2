const letter_ms = 55;

const reach_letters = 6;

const pause_letters = 72;

const dim = "var(--working-dim-opacity)";

export type WaveFrame = { opacity: number | string; offset: number };

export type WaveTiming = { duration: number; delay: number; iterations: number; easing: "linear" };

const cycle_letters = (letters: number): number => letters + 2 * reach_letters + pause_letters;

export const wave_frames = (letters: number): WaveFrame[] => {
  const cycle = cycle_letters(letters);
  return [
    { opacity: dim, offset: 0 },
    { opacity: 1, offset: reach_letters / cycle },
    { opacity: dim, offset: (2 * reach_letters) / cycle },
    { opacity: dim, offset: 1 },
  ];
};

export const wave_timing = (letters: number, index: number): WaveTiming => ({
  duration: cycle_letters(letters) * letter_ms,
  delay: index * letter_ms,
  iterations: Number.POSITIVE_INFINITY,
  easing: "linear",
});
