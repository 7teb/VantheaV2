import { useState, type CSSProperties } from "react";
import type { CompactResult } from "../../../shared/ipc/chats.ts";
import { Button, IconButton } from "../../components/Button.tsx";
import { result_keys } from "../../components/ContextRing.tsx";
import { CloseIcon, LayersIcon } from "../../components/icons.tsx";
import { compact_tokens } from "../../components/token-count.ts";
import { use_layer, use_presence, type Presence } from "../../components/use-layer.ts";
import { use_t, type MessageKey } from "../../i18n/index.ts";
import { compact_now } from "../../state/composer.ts";
import { close_panel, composer_panel_store } from "../../state/composer-panel.ts";
import { use_store } from "../../state/use-store.ts";
import { use_chat_busy, use_shown_context } from "./composer-hooks.ts";
import { cell_count, context_cells, context_rows, share_text, type ContextPart } from "./context-cells.ts";
import "./ContextPanel.css";

const part_keys: Record<ContextPart, MessageKey> = {
  system: "context.part_system",
  tools: "context.part_tools",
  messages: "context.part_messages",
  used: "context.part_used",
};

type ContextPanelProps = { panel_key: string; chat_id: string | null };

const ContextCard = ({ panel_key, chat_id, presence }: ContextPanelProps & { presence: Presence }) => {
  const t = use_t();
  const { usage, compact_at } = use_shown_context(chat_id);
  const busy = use_chat_busy(chat_id);
  const [running, set_running] = useState(false);
  const [result, set_result] = useState<CompactResult["status"] | null>(null);
  const close = () => close_panel(panel_key, "context");
  use_layer(presence.state === "open", close);

  const cells = context_cells(usage);
  const mark = compact_at === null ? -1 : Math.min(cell_count, Math.round(compact_at * cell_count)) - 1;
  const percent = usage && usage.limit > 0 ? Math.round(Math.min(1, usage.used / usage.limit) * 100) : 0;
  const summary = usage ? t("composer.context_usage", { used: compact_tokens(usage.used), limit: compact_tokens(usage.limit), percent }) : t("context.not_measured");

  const run_compact = async (id: string) => {
    set_running(true);
    set_result(null);
    set_result(await compact_now(id));
    set_running(false);
  };

  return (
    <div
      className="context-panel dock-panel composer-dock-card raised-surface enter-fade-up"
      data-state={presence.state}
      role="region"
      aria-label={t("context.title")}
      onAnimationEnd={presence.on_animation_end}
    >
      <div className="dock-panel-inner">
        <div className="context-panel-head">
          <LayersIcon size={16} className="context-panel-icon" />
          <span className="context-panel-title">{t("context.title")}</span>
          {usage && <span className="context-panel-total">{`${compact_tokens(usage.used)} / ${compact_tokens(usage.limit)}`}</span>}
          <IconButton size="sm" className="context-panel-close" label={t("context.close")} onClick={close}>
            <CloseIcon size={14} />
          </IconButton>
        </div>
        <div className="context-panel-body">
          <div className="context-grid" role="img" aria-label={summary}>
            {cells.map((cell, index) => (
              <i key={index} data-part={cell} data-mark={index === mark || undefined} style={{ "--cell": index } as CSSProperties} />
            ))}
          </div>
          <ul className="context-legend">
            {usage ? (
              <>
                {context_rows(usage).map((row) => (
                  <li key={row.part}>
                    <i data-part={row.part} />
                    <span className="context-legend-label">{t(part_keys[row.part])}</span>
                    <span className="context-legend-number">{compact_tokens(row.tokens)}</span>
                    <span className="context-legend-number">{share_text(row.tokens, usage.limit)}</span>
                  </li>
                ))}
                <li>
                  <i data-part="free" />
                  <span className="context-legend-label">{t("context.part_free")}</span>
                  <span className="context-legend-number">{compact_tokens(Math.max(0, usage.limit - usage.used))}</span>
                  <span className="context-legend-number">{share_text(Math.max(0, usage.limit - usage.used), usage.limit)}</span>
                </li>
              </>
            ) : (
              <li className="context-legend-note">{t("context.not_measured")}</li>
            )}
            {compact_at !== null && (
              <li className="context-legend-mark">
                <i data-mark />
                <span className="context-legend-label">{t("context.compact_line", { percent: Math.round(compact_at * 100) })}</span>
                <span className="context-legend-number">{usage ? compact_tokens(Math.round(usage.limit * compact_at)) : ""}</span>
                <span />
              </li>
            )}
          </ul>
        </div>
        {chat_id !== null && usage && (
          <div className="context-panel-foot">
            {result && (
              <span className="context-panel-result" data-status={result}>
                {t(result_keys[result])}
              </span>
            )}
            <Button className={running ? "is-working" : undefined} disabled={busy || running} onClick={() => void run_compact(chat_id)}>
              {running ? t("context.compacting") : t("context.compact_now")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export const ContextPanel = ({ panel_key, chat_id }: ContextPanelProps) => {
  const open = use_store(composer_panel_store, (state) => state?.key === panel_key && state.panel === "context");
  const presence = use_presence(open);
  return presence.mounted ? <ContextCard panel_key={panel_key} chat_id={chat_id} presence={presence} /> : null;
};
