import { use_t } from "../../i18n/index.ts";
import type { BodyProps } from "./body-types.ts";
import { CommandCard } from "./CommandCard.tsx";

export const BrowserBody = ({ view, step }: BodyProps<"browser">) => {
  const t = use_t();
  const expression = typeof step.args.expression === "string" ? step.args.expression : "";
  return <CommandCard shell={t("tools.eval_language")} command={expression} prompt={false} output={view.output ?? null} footer={null} wrap={step.status === "failed"} />;
};
