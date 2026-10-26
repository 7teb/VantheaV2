export const wave = { width: 32, height: 20, bar: 3, pitch: 6, step_ms: 200, radius: 1.5, floor: 3 } as const;

export const signal_rms = (samples: Float32Array): number => {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return samples.length === 0 ? 0 : Math.sqrt(sum / samples.length);
};

export const audio_level = (rms: number): number => Math.min(1, (Math.max(0, rms - 0.006) / 0.154) ** 0.6);

export const bar_height = (level: number): number => Math.max(wave.floor, (wave.height - wave.floor) * level);

export const bar_x = (age: number, progress: number): number => wave.width - wave.bar - wave.pitch * (age + progress);
