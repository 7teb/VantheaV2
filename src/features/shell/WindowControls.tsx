import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph } from "../../components/icons.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_t } from "../../i18n/index.ts";
import { use_store } from "../../state/use-store.ts";
import { close_window, minimize_window, toggle_maximize, window_store } from "../../state/window.ts";

export const WindowControls = () => {
  const t = use_t();
  const maximized = use_store(window_store, (state) => state?.maximized ?? false);
  const maximize_label = maximized ? t("shell.window_restore") : t("shell.window_maximize");

  return (
    <div className="window-controls">
      <Tooltip label={t("shell.window_minimize")}>
        <button type="button" className="caption-button" aria-label={t("shell.window_minimize")} onClick={minimize_window}>
          <MinimizeGlyph />
        </button>
      </Tooltip>
      <Tooltip label={maximize_label}>
        <button type="button" className="caption-button" aria-label={maximize_label} onClick={toggle_maximize}>
          {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
        </button>
      </Tooltip>
      <Tooltip label={t("shell.window_close")} placement="bottom-end">
        <button type="button" className="caption-button is-close" aria-label={t("shell.window_close")} onClick={close_window}>
          <CloseGlyph />
        </button>
      </Tooltip>
    </div>
  );
};
