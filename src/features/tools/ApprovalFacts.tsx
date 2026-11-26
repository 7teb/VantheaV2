import type { ReactNode } from "react";
import { use_t } from "../../i18n/index.ts";
import "./approval-facts.css";

type FactProps = { label: string; value: ReactNode; before?: ReactNode; code?: boolean };

export const Fact = ({ label, value, before = null, code = false }: FactProps) => {
  const t = use_t();
  return (
    <div className="approval-fact">
      <dt>{label}</dt>
      <dd className={code ? "approval-fact-code" : undefined}>
        {before !== null && (
          <s className="approval-fact-before">
            <span className="visually-hidden">{`${t("approval.previous")}: `}</span>
            {before}
          </s>
        )}
        <span>{value}</span>
      </dd>
    </div>
  );
};

export const ApprovalFacts = ({ children }: { children: ReactNode }) => <dl className="approval-facts">{children}</dl>;
