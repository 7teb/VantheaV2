import { useEffect, useState } from "react";
import type { Balance } from "../../../shared/settings.ts";
import { api } from "../../api/bridge.ts";
import { Skeleton } from "../../components/Skeleton.tsx";
import { use_t } from "../../i18n/index.ts";

type BalanceState = { status: "loading" } | { status: "ready"; balance: Balance | null } | { status: "failed" };

const usd = (value: number) => `$${value.toFixed(2)}`;

export const BalanceLine = ({ has_key, revision }: { has_key: boolean; revision: number }) => {
  const t = use_t();
  const [state, set_state] = useState<BalanceState>({ status: "loading" });

  useEffect(() => {
    if (!has_key) {
      return;
    }
    let alive = true;
    set_state({ status: "loading" });
    api
      .invoke("settings:balance")
      .then((balance) => {
        if (alive) {
          set_state({ status: "ready", balance });
        }
      })
      .catch((error) => {
        console.error("[settings] settings:balance failed", error);
        if (alive) {
          set_state({ status: "failed" });
        }
      });
    return () => {
      alive = false;
    };
  }, [has_key, revision]);

  if (!has_key) {
    return <span className="balance-line is-muted">{t("settings.balance_no_key")}</span>;
  }
  if (state.status === "loading") {
    return <Skeleton width={150} height={12} radius={5} className="balance-skeleton" />;
  }
  if (state.status === "failed" || state.balance === null) {
    return <span className="balance-line is-muted">{t("settings.balance_unavailable")}</span>;
  }
  const { limit, usage, remaining } = state.balance;
  if (limit === null) {
    return (
      <span className="balance-line">
        {t("settings.balance_no_limit")} · {t("settings.balance_spent", { usage: usd(usage) })}
      </span>
    );
  }
  const left = remaining ?? limit - usage;
  const fill = limit > 0 ? Math.max(0, Math.min(100, (left / limit) * 100)) : 0;
  return (
    <span className="balance-block">
      <span className="balance-line">{t("settings.balance_left", { remaining: usd(left), limit: usd(limit) })}</span>
      <span className="balance-bar" aria-hidden="true">
        <span style={{ width: `${fill}%` }} />
      </span>
    </span>
  );
};
