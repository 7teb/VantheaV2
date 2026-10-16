import { agent_blooms, type AgentBloom } from "./agent-blooms.tsx";
import { agent_sprites, agent_tints, type AgentSprite, type AgentTint } from "./agent-sprites.ts";
import { class_names } from "./class-names.ts";
import type { IconProps } from "./icons-base.tsx";
import "./critters.css";

type Glyph = { kind: "sprite"; sprite: AgentSprite } | { kind: "bloom"; bloom: AgentBloom };

const glyphs: Glyph[] = [...agent_sprites.map((sprite): Glyph => ({ kind: "sprite", sprite })), ...agent_blooms.map((bloom): Glyph => ({ kind: "bloom", bloom }))];

const neutral: Glyph = { kind: "sprite", sprite: agent_sprites[0] as AgentSprite };

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

const glyph_key = (glyph: Glyph) => (glyph.kind === "sprite" ? glyph.sprite.key : glyph.bloom.key);

type CritterIconProps = { name: string | null; running?: boolean; className?: string };

export const CritterIcon = ({ name, running = false, className }: CritterIconProps) => {
  const hash = name === null ? 0 : name_hash(name);
  const glyph = name === null ? neutral : (glyphs[hash % glyphs.length] as Glyph);
  const tint: AgentTint | undefined = name === null ? undefined : glyph.kind === "sprite" ? glyph.sprite.tint : agent_tints[(hash >>> 8) % agent_tints.length];
  const shared = {
    "aria-hidden": true,
    focusable: false,
    className: class_names("critter", running && "is-running", className),
    "data-shape": glyph.kind,
    "data-glyph": name === null ? undefined : glyph_key(glyph),
    "data-tint": tint,
  };
  if (glyph.kind === "bloom") {
    return (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" {...shared}>
        {glyph.bloom.body}
      </svg>
    );
  }
  const { grid, size, path } = glyph.sprite;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${grid} ${grid}`} shapeRendering="crispEdges" {...shared}>
      <path fill="currentColor" d={path} />
    </svg>
  );
};

export const CritterMark = ({ className }: IconProps) => <CritterIcon name={null} className={className} />;

export const MainAgentIcon = ({ chat_id }: { chat_id: string }) => <CritterIcon name={`main:${chat_id}`} />;
