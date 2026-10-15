import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { MemoryRecord } from "../../../shared/ipc/extensions.ts";
import { Button, IconButton } from "../../components/Button.tsx";
import { CloseIcon, PlusIcon, TrashIcon, WormIcon } from "../../components/icons.tsx";
import { use_layer } from "../../components/use-layer.ts";
import { SkeletonRows } from "../../components/Skeleton.tsx";
import { TextField } from "../../components/TextField.tsx";
import { use_t } from "../../i18n/index.ts";
import { add_memory, load_saved_memories, memory_store, remove_memory } from "../../state/extensions.ts";
import { close_memories, memories_panel_store } from "../../state/memories-panel.ts";
import { settings_store } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";
import { base_name } from "../tools/tool-meta.ts";
import { ipc_error_text } from "../settings/panes/ipc-error.ts";
import { focus_composer_input } from "./composer-hooks.ts";
import "./MemoriesPanel.css";

const MemoryRow = ({ record }: { record: MemoryRecord }) => {
  const t = use_t();
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState("");

  const remove = async () => {
    set_busy(true);
    set_error("");
    try {
      await remove_memory(record.id);
    } catch (failure) {
      console.error(`[memories] memory:remove failed for ${record.id}`, failure);
      set_error(ipc_error_text(failure));
      set_busy(false);
    }
  };

  return (
    <li className="memories-row">
      <div className="memories-row-text">
        <span className="memories-row-title">{record.text}</span>
        {record.project_path && <span className="memories-row-meta">{base_name(record.project_path)}</span>}
        {error && <span className="memories-row-error">{error}</span>}
      </div>
      <IconButton size="sm" className="memories-row-remove" label={t("personalization.mem_remove")} disabled={busy} onClick={() => void remove()}>
        <TrashIcon size={14} />
      </IconButton>
    </li>
  );
};

const MemoriesCard = ({ panel_key }: { panel_key: string }) => {
  const t = use_t();
  const card = useRef<HTMLDivElement>(null);
  const memories = use_store(memory_store, (state) => state);
  const enabled = use_store(settings_store, (state) => state?.memory.enabled ?? true);
  const [text, set_text] = useState("");
  const [adding, set_adding] = useState(false);
  const [error, set_error] = useState("");
  const close = () => close_memories(panel_key);
  use_layer(true, close);

  useEffect(() => {
    void load_saved_memories();
  }, []);

  useLayoutEffect(() => {
    const node = card.current;
    const slot = node?.closest(".composer-slot");
    return () => {
      if (!node || !slot || !node.contains(document.activeElement)) {
        return;
      }
      queueMicrotask(() => {
        const idle = document.activeElement === null || document.activeElement === document.body;
        if (idle && slot.isConnected) {
          focus_composer_input(slot);
        }
      });
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!text.trim() || adding) {
      return;
    }
    set_adding(true);
    set_error("");
    try {
      await add_memory(text);
      set_text("");
    } catch (failure) {
      console.error(`[memories] memory:add failed for a ${text.length}-character text`, failure);
      set_error(ipc_error_text(failure));
    } finally {
      set_adding(false);
    }
  };

  const count = memories.status === "ready" ? memories.items.length : 0;
  return (
    <div ref={card} className="memories-panel composer-dock-card raised-surface enter-fade-up" role="region" aria-label={t("memories.title")}>
      <div className="memories-head">
        <WormIcon size={16} className="memories-head-icon" />
        <span className="memories-title">{t("memories.title")}</span>
        {count > 0 && <span className="memories-count">{count}</span>}
        <IconButton size="sm" className="memories-close" label={t("memories.close")} onClick={close}>
          <CloseIcon size={14} />
        </IconButton>
      </div>
      {!enabled && <p className="memories-note">{t("memories.off")}</p>}
      {memories.status === "loading" && <SkeletonRows widths={[82, 64, 74]} row_height={32} className="memories-skeleton" />}
      {memories.status === "failed" && <p className="memories-note">{t("personalization.mem_load_failed")}</p>}
      {count > 0 && (
        <ul className="memories-list">
          {memories.items.map((record) => (
            <MemoryRow key={record.id} record={record} />
          ))}
        </ul>
      )}
      <form className="memories-add" onSubmit={(event) => void submit(event)}>
        <TextField
          value={text}
          on_change={set_text}
          placeholder={t("memories.add_placeholder")}
          aria-label={t("memories.add_placeholder")}
          autoFocus
          className="memories-input"
        />
        <Button type="submit" icon={<PlusIcon size={14} />} disabled={adding || !text.trim()}>
          {t("memories.add")}
        </Button>
      </form>
      {error && <p className="memories-error">{error}</p>}
    </div>
  );
};

export const MemoriesPanel = ({ panel_key }: { panel_key: string }) => {
  const open = use_store(memories_panel_store, (state) => state === panel_key);
  return open ? <MemoriesCard panel_key={panel_key} /> : null;
};
