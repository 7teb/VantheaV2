export const orbit_period_ms = 7200;

export type OrbitFrame = { offset: number; transform: string; opacity: number; zIndex: number };

const steps = 144;
const orbits = 4;
const radius = 6;
const depth_scale = 0.34;
const back_opacity = 0.62;
const degree = Math.PI / 180;

const elevation_at = (t: number): number => (18 + 52 * Math.sin(2 * Math.PI * t) + 20 * Math.sin(6 * Math.PI * t + 1.1)) * degree;

const orbit_frames = (dot: number): OrbitFrame[] => {
  const phase = (dot * 2 * Math.PI) / 3;
  return Array.from({ length: steps + 1 }, (_, step) => {
    const t = step / steps;
    const angle = phase + orbits * 2 * Math.PI * t;
    const elevation = elevation_at(t);
    const front = -Math.sin(angle);
    const depth = Math.cos(elevation) * front;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(elevation) * front;
    return {
      offset: t,
      transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(1 + depth_scale * depth).toFixed(3)})`,
      opacity: Number((back_opacity + ((1 - back_opacity) * (depth + 1)) / 2).toFixed(3)),
      zIndex: depth >= 0 ? 2 : 1,
    };
  });
};

export const orbit_keyframes: OrbitFrame[][] = [0, 1, 2].map(orbit_frames);
