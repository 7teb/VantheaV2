import { useState } from "react";
import { Lightbox, type LightboxImage } from "../chat/Lightbox.tsx";
import { tool_image_src } from "../chat/media.ts";
import { MediaImage } from "../chat/MediaImage.tsx";
import type { ViewedImage } from "./work-steps.ts";
import "./ViewedImage.css";

export const ViewedImageBody = ({ image }: { image: ViewedImage }) => {
  const [open, set_open] = useState<LightboxImage | null>(null);
  const src = tool_image_src(image.id);
  return (
    <>
      <MediaImage src={src} alt={image.name} className="viewed-image" on_open={() => set_open({ src, alt: image.name })} />
      <Lightbox image={open} on_close={() => set_open(null)} />
    </>
  );
};
