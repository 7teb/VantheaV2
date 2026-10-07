import { useState } from "react";
import { Dialog } from "../../components/Dialog.tsx";
import { use_t } from "../../i18n/index.ts";
import "./Lightbox.css";

export type LightboxImage = { src: string; alt: string };

type LightboxProps = { image: LightboxImage | null; on_close: () => void };

export const Lightbox = ({ image, on_close }: LightboxProps) => {
  const t = use_t();
  const [shown, set_shown] = useState<LightboxImage | null>(image);
  if (image !== null && image !== shown) {
    set_shown(image);
  }
  return (
    <Dialog
      open={image !== null}
      on_close={on_close}
      label={shown?.alt || t("chat.image_preview")}
      className="lightbox-panel"
      backdrop_className="lightbox-backdrop"
      initial_focus="panel"
    >
      {shown && <img className="lightbox-image" src={shown.src} alt={shown.alt} onClick={on_close} />}
    </Dialog>
  );
};
