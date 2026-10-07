import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { ChatSearchHit } from "../../../shared/chat.ts";
import { api } from "../../api/bridge.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { MessageSquareIcon, SearchIcon } from "../../components/icons.tsx";
import { SkeletonRows } from "../../components/Skeleton.tsx";
import { TextField } from "../../components/TextField.tsx";
import { use_t } from "../../i18n/index.ts";
import { relative_time } from "../../i18n/relative-time.ts";
import { chats_store } from "../../state/chats.ts";
import { close_search, open_chat, ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import { chat_label } from "../sidebar/sidebar-model.ts";
import "./SearchOverlay.css";

type Results = { query: string; status: "loading" | "ready" | "failed"; hits: ChatSearchHit[] };

const search_delay_ms = 140;
const recent_limit = 30;

const use_search = (query: string): Results => {
  const [results, set_results] = useState<Results>({ query: "", status: "ready", hits: [] });
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === "") {
      return;
    }
    let alive = true;
    set_results((current) => ({ ...current, query: trimmed, status: "loading" }));
    const timer = window.setTimeout(() => {
      api
        .invoke("chats:search", trimmed)
        .then((hits) => {
          if (alive) {
            set_results({ query: trimmed, status: "ready", hits });
          }
        })
        .catch((error) => {
          console.error(`[search] chats:search failed for query ${JSON.stringify(trimmed)}`, error);
          if (alive) {
            set_results({ query: trimmed, status: "failed", hits: [] });
          }
        });
    }, search_delay_ms);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);
  return results;
};

const SearchPanel = () => {
  const t = use_t();
  const [query, set_query] = useState("");
  const [cursor, set_cursor] = useState(0);
  const chats = use_store(chats_store, (state) => state.list);
  const searched = use_search(query);
  const searching = query.trim() !== "";
  const now = Date.now();

  const recent = useMemo<ChatSearchHit[]>(
    () =>
      [...chats]
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .slice(0, recent_limit)
        .map((chat) => ({ chat_id: chat.id, title: chat.title, project_path: chat.project_path, snippet: "", updated_at: chat.updated_at })),
    [chats],
  );
  const hits = searching ? searched.hits : recent;
  const active = Math.min(cursor, Math.max(0, hits.length - 1));

  const choose = (hit: ChatSearchHit) => open_chat(hit.chat_id, hit.project_path);

  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      set_cursor(hits.length === 0 ? 0 : (active + step + hits.length) % hits.length);
      return;
    }
    if (event.key === "Enter" && hits[active]) {
      event.preventDefault();
      choose(hits[active]);
    }
  };

  const status = () => {
    if (searching && searched.status === "loading" && searched.hits.length === 0) {
      return <SkeletonRows widths={[72, 54, 80, 62]} row_height={52} icon />;
    }
    if (searching && searched.status === "failed") {
      return <div className="search-empty">{t("search.failed")}</div>;
    }
    if (hits.length === 0) {
      return <div className="search-empty">{t("search.no_results")}</div>;
    }
    return null;
  };

  return (
    <div className="search-panel" onKeyDown={on_key_down}>
      <TextField
        className="search-field"
        value={query}
        on_change={(next) => {
          set_query(next);
          set_cursor(0);
        }}
        icon={<SearchIcon size={17} />}
        placeholder={t("search.placeholder")}
        aria-label={t("search.label")}
        role="combobox"
        aria-expanded="true"
        aria-controls="search-results"
        aria-activedescendant={hits[active] ? `search-hit-${hits[active].chat_id}` : undefined}
      />
      {!searching && hits.length > 0 && <div className="search-heading section-label">{t("search.recent")}</div>}
      <div className="search-results" id="search-results" role="listbox" aria-label={t("search.label")}>
        {status() ??
          hits.map((hit, index) => (
            <button
              key={hit.chat_id}
              id={`search-hit-${hit.chat_id}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className="search-hit"
              onMouseMove={() => set_cursor(index)}
              onClick={() => choose(hit)}
            >
              <MessageSquareIcon size={16} className="search-hit-icon" />
              <span className="search-hit-text">
                <span className="search-hit-title">{chat_label(t, hit.title)}</span>
                <span className="search-hit-detail">{hit.snippet || hit.project_path || t("search.no_project")}</span>
              </span>
              <span className="search-hit-time">{relative_time(t, hit.updated_at, now)}</span>
            </button>
          ))}
      </div>
    </div>
  );
};

export const SearchOverlay = () => {
  const t = use_t();
  const open = use_store(ui_store, (state) => state.search_open);
  return (
    <Dialog open={open} on_close={close_search} label={t("search.label")} className="search-dialog" backdrop_className="search-backdrop">
      <SearchPanel />
    </Dialog>
  );
};
