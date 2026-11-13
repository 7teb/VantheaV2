import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ModelCatalog, ModelChoice, ModelEntry } from "../../../shared/models.ts";
import { Floating } from "../../components/Floating.tsx";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "../../components/icons.tsx";
import { LabelMorph } from "../../components/LabelMorph.tsx";
import { menu_keys, move_focus } from "../../components/Menu.tsx";
import { use_t } from "../../i18n/index.ts";
import { effort_label } from "./composer-hooks.ts";
import { EffortSlider } from "./EffortSlider.tsx";
import { choice_view, with_model } from "./model-menu.ts";
import "./ModelMenu.css";

export type ModelMenuView = "effort" | "models";

type ModelMenuProps = {
  open: boolean;
  anchor: HTMLElement | null;
  catalog: ModelCatalog;
  choice: ModelChoice;
  view: ModelMenuView;
  on_view: (view: ModelMenuView) => void;
  on_choice: (choice: ModelChoice) => void;
  on_close: () => void;
};

type Heights = Record<ModelMenuView, number>;

const effort_targets = ".model-menu-toggle, .effort-slider-input";

export const ModelMenu = ({ open, anchor, catalog, choice, view, on_view, on_choice, on_close }: ModelMenuProps) => {
  const t = use_t();
  const effort_panel = useRef<HTMLDivElement>(null);
  const models_panel = useRef<HTMLDivElement>(null);
  const [heights, set_heights] = useState<Heights | null>(null);
  const [preview, set_preview] = useState<string | null>(null);
  const { model, effort } = choice_view(catalog, choice);
  const efforts = model?.efforts ?? [];
  const has_slider = efforts.length > 1;
  const shown: ModelMenuView = has_slider ? view : "models";
  if (preview !== null && (preview === effort || !open)) {
    set_preview(null);
  }
  const shown_effort = preview ?? effort;

  useLayoutEffect(() => {
    const effort_node = effort_panel.current;
    const models_node = models_panel.current;
    if (!open || !effort_node || !models_node) {
      return;
    }
    const measure = () => {
      const next = { effort: effort_node.offsetHeight, models: models_node.offsetHeight };
      set_heights((current) => (current && current.effort === next.effort && current.models === next.models ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(effort_node);
    observer.observe(models_node);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (shown === "effort") {
      effort_panel.current?.querySelector<HTMLElement>(".effort-slider-input")?.focus({ preventScroll: true });
      return;
    }
    const panel = models_panel.current;
    const row = panel?.querySelector<HTMLElement>('.menu-item[aria-checked="true"]') ?? panel?.querySelector<HTMLElement>(".menu-item");
    if (!panel || !row) {
      return;
    }
    panel.scrollTop = row.offsetTop - (panel.clientHeight - row.offsetHeight) / 2;
    row.focus({ preventScroll: true });
  }, [open, shown]);

  const back = () => {
    if (has_slider) {
      on_view("effort");
    }
  };

  const pick_model = (entry: ModelEntry) => {
    set_preview(null);
    on_choice(with_model(choice, entry));
    if (entry.efforts.length > 1) {
      on_view("effort");
      return;
    }
    on_close();
  };

  const pick_effort = (index: number) => {
    const next = efforts[index];
    set_preview(next);
    on_choice({ ...choice, effort: next });
  };

  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      on_close();
      return;
    }
    const step = menu_keys[event.key];
    if (shown === "models") {
      if (step !== undefined && models_panel.current) {
        event.preventDefault();
        move_focus(models_panel.current, step);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "Backspace") {
        event.preventDefault();
        back();
      }
      return;
    }
    const on_slider = event.target instanceof HTMLInputElement;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && effort_panel.current) {
      event.preventDefault();
      move_focus(effort_panel.current, event.key === "ArrowDown" ? 1 : -1, effort_targets);
      return;
    }
    if (event.key === "Enter" && on_slider) {
      event.preventDefault();
      on_close();
      return;
    }
    if (event.key === "ArrowRight" && !on_slider) {
      event.preventDefault();
      on_view("models");
    }
  };

  return (
    <Floating
      open={open}
      anchor={anchor}
      on_close={on_close}
      placement="top-start"
      className="menu composer-menu model-menu"
      role="menu"
      label={t("composer.model_select")}
      min_width={260}
      on_key_down={on_key_down}
    >
      <div className="model-menu-views" data-view={shown} style={heights ? { height: heights[shown] } : undefined}>
        <div ref={effort_panel} className="model-menu-view" data-active={shown === "effort"} inert={shown !== "effort"}>
          <div className="model-menu-head">
            <button type="button" role="menuitem" aria-haspopup="menu" tabIndex={-1} className="model-menu-toggle" onClick={() => on_view("models")}>
              <span className="model-menu-current">
                <span className="model-menu-current-model">{model?.label ?? t("composer.model_fallback")}</span>
                {has_slider && (
                  <span className="model-menu-current-effort" data-effort={shown_effort}>
                    <LabelMorph morph_key={shown_effort}>{effort_label(t, shown_effort)}</LabelMorph>
                  </span>
                )}
                <span className="model-menu-chevron">
                  <ChevronRightIcon size={12} />
                </span>
              </span>
            </button>
          </div>
          {has_slider && (
            <EffortSlider
              index={Math.max(0, efforts.indexOf(shown_effort))}
              count={efforts.length}
              highlighted={shown_effort === "major"}
              label={t("composer.model_effort")}
              value_text={effort_label(t, shown_effort)}
              on_change={pick_effort}
            />
          )}
        </div>
        <div
          ref={models_panel}
          className="model-menu-view model-menu-models"
          data-active={shown === "models"}
          inert={shown !== "models"}
          role="group"
          aria-label={t("composer.model_model")}
        >
          {has_slider ? (
            <button type="button" tabIndex={-1} className="menu-section-label model-menu-back" aria-label={t("commands.back")} onClick={back}>
              <ChevronLeftIcon />
              <span>{t("composer.model_model")}</span>
            </button>
          ) : (
            <div className="menu-section-label">{t("composer.model_model")}</div>
          )}
          {catalog.models.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={entry.id === choice.model}
              tabIndex={-1}
              className="menu-item"
              onClick={() => pick_model(entry)}
            >
              <span className="menu-item-label">{entry.label}</span>
              <span className="menu-item-check">{entry.id === choice.model && <CheckIcon />}</span>
            </button>
          ))}
        </div>
      </div>
    </Floating>
  );
};
