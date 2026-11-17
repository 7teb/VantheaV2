import { ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";
import "./BrandField.css";

const blobs = (
  <>
    <i className="brand-blob is-accent" />
    <i className="brand-blob is-deep" />
    <i className="brand-blob is-light" />
  </>
);

export const BrandField = () => {
  const collapsed = use_store(ui_store, (state) => state.sidebar_collapsed);
  return (
    <div className="brand-field" data-state={collapsed ? "closed" : "open"} aria-hidden="true">
      <div className="brand-aurora">{blobs}</div>
      <div className="brand-grid">{blobs}</div>
    </div>
  );
};
