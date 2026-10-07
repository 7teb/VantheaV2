import { useState } from "react";
import { class_names } from "../../components/class-names.ts";
import { ImageIcon } from "../../components/icons.tsx";
import "./MediaImage.css";

type MediaImageProps = { src: string; alt: string; ratio?: number | null; className?: string; on_open?: () => void };

export const MediaImage = ({ src, alt, ratio = null, className, on_open }: MediaImageProps) => {
  const [state, set_state] = useState<"loading" | "ready" | "failed">("loading");
  return (
    <button
      type="button"
      className={class_names("media-image", className)}
      data-state={state}
      style={ratio ? { aspectRatio: ratio } : undefined}
      onClick={on_open}
      disabled={!on_open || state !== "ready"}
      aria-label={alt}
    >
      {state === "failed" ? (
        <span className="media-image-missing">
          <ImageIcon size={18} />
        </span>
      ) : (
        <img src={src} alt={alt} loading="lazy" onLoad={() => set_state("ready")} onError={() => set_state("failed")} />
      )}
    </button>
  );
};
