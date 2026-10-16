export type AgentTint = "amber" | "coral" | "pink" | "violet" | "teal" | "green" | "sand" | "stone";

export const agent_tints: AgentTint[] = ["amber", "coral", "pink", "violet", "teal", "green", "sand", "stone"];

export type AgentSprite = { key: string; grid: number; size: number; tint: AgentTint; path: string };

const small = (key: string, tint: AgentTint, path: string): AgentSprite => ({ key, grid: 5, size: 15, tint, path });

const large = (key: string, tint: AgentTint, path: string): AgentSprite => ({ key, grid: 7, size: 14, tint, path });

export const agent_sprites: AgentSprite[] = [
  small("crawler", "amber", "M1 0h3v1h-3zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM1 2h3v1h-3zM0 3h1v1h-1zM2 3h1v1h-1zM4 3h1v1h-1zM0 4h5v1h-5z"),
  small("hopper", "coral", "M1 0h3v1h-3zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM1 3h3v1h-3zM0 4h1v1h-1zM4 4h1v1h-1z"),
  small("imp", "pink", "M0 0h2v1h-2zM3 0h2v1h-2zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM2 3h1v1h-1zM0 4h1v1h-1zM4 4h1v1h-1z"),
  small("walker", "violet", "M1 0h3v1h-3zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM1 3h3v1h-3zM1 4h1v1h-1zM3 4h1v1h-1z"),
  small("chonk", "teal", "M0 0h5v1h-5zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM0 3h5v1h-5zM0 4h2v1h-2zM3 4h2v1h-2z"),
  small("bug", "green", "M1 0h1v1h-1zM3 0h1v1h-1zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM1 2h3v1h-3zM1 3h3v1h-3zM0 4h5v1h-5z"),
  small("shroom", "sand", "M0 0h5v1h-5zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM2 3h1v1h-1zM2 4h1v1h-1z"),
  small("sprout", "stone", "M1 0h3v1h-3zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM1 2h3v1h-3zM0 3h5v1h-5zM2 4h1v1h-1z"),
  large("cat", "amber", "M0 0h1v1h-1zM6 0h1v1h-1zM0 1h2v1h-2zM5 1h2v1h-2zM0 2h7v1h-7zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM0 4h7v1h-7zM1 5h2v1h-2zM4 5h2v1h-2zM2 6h3v1h-3z"),
  large("bunny", "stone", "M1 0h1v1h-1zM5 0h1v1h-1zM1 1h1v1h-1zM5 1h1v1h-1zM1 2h5v1h-5zM1 3h1v1h-1zM3 3h1v1h-1zM5 3h1v1h-1zM0 4h7v1h-7zM1 5h5v1h-5zM1 6h2v1h-2zM4 6h2v1h-2z"),
  large("frog", "green", "M1 1h2v1h-2zM4 1h2v1h-2zM0 2h2v1h-2zM3 2h1v1h-1zM5 2h2v1h-2zM0 3h7v1h-7zM0 4h1v1h-1zM6 4h1v1h-1zM1 5h5v1h-5zM0 6h2v1h-2zM5 6h2v1h-2z"),
  large("owl", "sand", "M0 0h1v1h-1zM6 0h1v1h-1zM0 1h7v1h-7zM0 2h2v1h-2zM3 2h1v1h-1zM5 2h2v1h-2zM0 3h7v1h-7zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM1 5h5v1h-5zM2 6h1v1h-1zM4 6h1v1h-1z"),
  large("fish", "violet", "M1 1h3v1h-3zM6 1h1v1h-1zM0 2h1v1h-1zM2 2h5v1h-5zM0 3h7v1h-7zM1 4h3v1h-3zM6 4h1v1h-1zM2 5h1v1h-1z"),
  large("crab", "coral", "M0 0h2v1h-2zM5 0h2v1h-2zM1 1h1v1h-1zM5 1h1v1h-1zM1 2h5v1h-5zM0 3h2v1h-2zM3 3h1v1h-1zM5 3h2v1h-2zM0 4h7v1h-7zM1 5h5v1h-5zM0 6h1v1h-1zM2 6h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1z"),
  large("octo", "pink", "M2 0h3v1h-3zM1 1h5v1h-5zM1 2h1v1h-1zM3 2h1v1h-1zM5 2h1v1h-1zM1 3h5v1h-5zM0 4h7v1h-7zM0 5h1v1h-1zM2 5h1v1h-1zM4 5h1v1h-1zM6 5h1v1h-1zM0 6h1v1h-1zM2 6h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1z"),
  large("slime", "teal", "M3 1h1v1h-1zM2 2h3v1h-3zM1 3h5v1h-5zM0 4h2v1h-2zM3 4h1v1h-1zM5 4h2v1h-2zM0 5h7v1h-7zM1 6h5v1h-5z"),
];
