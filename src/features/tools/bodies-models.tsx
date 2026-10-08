import { use_t } from "../../i18n/index.ts";
import type { BodyProps } from "./body-types.ts";
import "./bodies-models.css";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const ModelsBody = ({ view }: BodyProps<"models">) => {
  const t = use_t();
  const price = (value: number | null) => (value === null ? t("tools.price_unavailable") : usd.format(value));
  return (
    <div className="tool-body-stack">
      <div className="model-prices inset-surface">
        <span className="model-prices-head">{t("tools.model_price_unit")}</span>
        <span className="model-prices-head model-prices-amount">{t("tools.model_input")}</span>
        <span className="model-prices-head model-prices-amount">{t("tools.model_output")}</span>
        {view.models.map((model) => (
          <div key={model.id} className="model-prices-row" title={model.error || model.note || model.endpoint}>
            <span className="model-prices-model">
              <span className="model-prices-name">{model.label}</span>
              <span className="model-prices-slug">{model.id}</span>
            </span>
            <span className="model-prices-amount">{price(model.input)}</span>
            <span className="model-prices-amount">{price(model.output)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
