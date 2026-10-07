import { useEffect, useState } from "react";
import type { MemoryRecord, MemoryReviewItem } from "../../../../shared/ipc/extensions.ts";
import { Button, IconButton } from "../../../components/Button.tsx";
import { CheckIcon, CloseIcon, TrashIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { relative_time } from "../../../i18n/relative-time.ts";
import { load_memory, memory_review_store, memory_store, remove_memory, resolve_memory_review } from "../../../state/extensions.ts";
import { use_store } from "../../../state/use-store.ts";
import { SettingsGroup } from "../SettingsLayout.tsx";
import { ipc_error_text } from "./ipc-error.ts";
import { ListSkeleton } from "./PaneSkeleton.tsx";

const folder_name = (value: string) => value.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || value;

const ReviewItem = ({ item }: { item: MemoryReviewItem }) => {
  const t = use_t();
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const resolve = async (action: "keep" | "discard") => {
    set_busy(true);
    set_error(null);
    try {
      await resolve_memory_review(item.id, action);
    } catch (failure) {
      console.error(`[settings] memory:resolve ${action} failed for ${item.id}`, failure);
      set_error(ipc_error_text(failure));
      set_busy(false);
    }
  };

  return (
    <div className="pane-item">
      <div className="pane-item-text">
        <div className="pane-item-title is-wrapping">{item.text}</div>
        {item.reason && <div className="pane-item-quote">{item.reason}</div>}
        {error && <div className="pane-item-error">{error}</div>}
      </div>
      <div className="pane-item-actions is-visible">
        <Button variant="ghost" disabled={busy} icon={<CloseIcon size={14} />} onClick={() => void resolve("discard")}>
          {t("personalization.mem_reject")}
        </Button>
        <Button disabled={busy} icon={<CheckIcon size={14} />} onClick={() => void resolve("keep")}>
          {t("personalization.mem_accept")}
        </Button>
      </div>
    </div>
  );
};

const MemoryItem = ({ record, now }: { record: MemoryRecord; now: number }) => {
  const t = use_t();
  const [error, set_error] = useState<string | null>(null);
  const scope = record.project_path ? folder_name(record.project_path) : t("personalization.mem_global");

  const remove = async () => {
    set_error(null);
    try {
      await remove_memory(record.id);
    } catch (failure) {
      console.error(`[settings] memory:remove failed for ${record.id}`, failure);
      set_error(ipc_error_text(failure));
    }
  };

  return (
    <div className="pane-item">
      <div className="pane-item-text">
        <div className="pane-item-title is-wrapping">{record.text}</div>
        <div className="pane-item-meta">
          {scope} · {relative_time(t, record.created_at, now)}
        </div>
        {error && <div className="pane-item-error">{error}</div>}
      </div>
      <div className="pane-item-actions">
        <IconButton size="sm" label={t("personalization.mem_remove")} onClick={() => void remove()}>
          <TrashIcon size={14} />
        </IconButton>
      </div>
    </div>
  );
};

export const MemoryLists = () => {
  const t = use_t();
  const memories = use_store(memory_store, (state) => state);
  const review = use_store(memory_review_store, (state) => state);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    void load_memory();
  }, []);

  return (
    <>
      <SettingsGroup label={t("personalization.mem_review")}>
        {review.status === "loading" && <ListSkeleton rows={[72, 58]} />}
        {review.status === "failed" && <p className="pane-note">{t("personalization.mem_load_failed")}</p>}
        {review.status === "ready" && review.items.length === 0 && <p className="pane-note">{t("personalization.mem_empty")}</p>}
        {review.status === "ready" && review.items.map((item) => <ReviewItem key={item.id} item={item} />)}
      </SettingsGroup>
      <SettingsGroup label={t("personalization.mem_saved")}>
        {memories.status === "loading" && <ListSkeleton rows={[84, 66, 76]} />}
        {memories.status === "failed" && <p className="pane-note">{t("personalization.mem_load_failed")}</p>}
        {memories.status === "ready" && memories.items.length === 0 && <p className="pane-note">{t("personalization.mem_saved_empty")}</p>}
        {memories.status === "ready" && memories.items.map((record) => <MemoryItem key={record.id} record={record} now={now} />)}
      </SettingsGroup>
    </>
  );
};
