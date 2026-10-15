import type { IconProps } from "./icons-base.tsx";
import { class_names } from "./class-names.ts";
import "./critters.css";

type Critter = { key: string; path: string };

const critters: Critter[] = [
  { key: "crawler", path: "M1 0h3v1h-3zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM1 2h3v1h-3zM0 3h1v1h-1zM2 3h1v1h-1zM4 3h1v1h-1zM0 4h5v1h-5z" },
  { key: "hopper", path: "M1 0h3v1h-3zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM1 3h3v1h-3zM0 4h1v1h-1zM4 4h1v1h-1z" },
  { key: "imp", path: "M0 0h2v1h-2zM3 0h2v1h-2zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM2 3h1v1h-1zM0 4h1v1h-1zM4 4h1v1h-1z" },
  { key: "walker", path: "M1 0h3v1h-3zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM1 3h3v1h-3zM1 4h1v1h-1zM3 4h1v1h-1z" },
  { key: "chonk", path: "M0 0h5v1h-5zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM0 3h5v1h-5zM0 4h2v1h-2zM3 4h2v1h-2z" },
  { key: "bug", path: "M1 0h1v1h-1zM3 0h1v1h-1zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM1 2h3v1h-3zM1 3h3v1h-3zM0 4h5v1h-5z" },
  { key: "shroom", path: "M0 0h5v1h-5zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM0 2h5v1h-5zM2 3h1v1h-1zM2 4h1v1h-1z" },
  { key: "sprout", path: "M1 0h3v1h-3zM0 1h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM1 2h3v1h-3zM0 3h5v1h-5zM2 4h1v1h-1z" },
];

const name_hash = (name: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

type CritterIconProps = { name: string | null; running?: boolean; className?: string };

export const CritterIcon = ({ name, running = false, className }: CritterIconProps) => {
  const critter = critters[name === null ? 0 : name_hash(name) % critters.length];
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 5 5"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      className={class_names("critter", running && "is-running", className)}
      data-critter={name === null ? undefined : critter.key}
    >
      <path fill="currentColor" d={critter.path} />
    </svg>
  );
};

export const CritterMark = ({ className }: IconProps) => <CritterIcon name={null} className={className} />;
