import type { ReactNode } from "react";
import { changed_fields, type HookFields } from "../../../shared/hooks.ts";
import { shell_labels } from "../../../shared/shell.ts";
import { use_t } from "../../i18n/index.ts";
import { DiffView } from "./DiffView.tsx";
import { command_change } from "./hook-preview.ts";
import { event_label, matcher_label, matcher_text, seconds_text } from "./hook-text.ts";
import { PreviewText } from "./PreviewText.tsx";
import "./approval.css";
import "./bodies-files.css";
import "./hooks.css";

type FactProps = { label: string; value: ReactNode; before?: ReactNode; code?: boolean; title?: string };

const Fact = ({ label, value, before = null, code = false, title }: FactProps) => {
  const t = use_t();
  return (
    <div className="hook-fact">
      <dt>{label}</dt>
      <dd className={code ? "hook-fact-code" : undefined} title={title || undefined}>
        {before !== null && (
          <s className="hook-fact-before">
            <span className="visually-hidden">{`${t("hooks.previous")}: `}</span>
            {before}
          </s>
        )}
        <span>{value}</span>
      </dd>
    </div>
  );
};

type HookPreviewProps = { hook: HookFields; previous: HookFields | null; scope: string; scope_title: string };

export const HookPreview = ({ hook, previous, scope, scope_title }: HookPreviewProps) => {
  const t = use_t();
  const changed = new Set(previous ? changed_fields(hook, previous) : []);
  const was = (key: keyof HookFields): boolean => previous !== null && changed.has(key);
  const matcher = matcher_text(t, hook.event, hook.matcher);
  const previous_matcher = previous ? matcher_text(t, previous.event, previous.matcher) : null;
  const state = (enabled: boolean) => t(enabled ? "hooks.state_on" : "hooks.state_off");
  const shell = shell_labels[hook.shell];
  return (
    <div className="hook-preview">
      <dl className="hook-facts">
        <Fact label={t("hooks.scope_label")} value={scope} title={scope_title} />
        <Fact label={t("hooks.event_label")} value={event_label(t, hook.event)} before={previous && was("event") ? event_label(t, previous.event) : null} />
        {matcher && (
          <Fact
            label={matcher_label(t, hook.event) ?? ""}
            value={matcher.text}
            code={!matcher.all}
            before={was("matcher") || was("event") ? (previous_matcher?.text ?? null) : null}
          />
        )}
        {previous && was("shell") && <Fact label={t("hooks.shell_label")} value={shell} before={shell_labels[previous.shell]} />}
        <Fact label={t("hooks.timeout_fact")} value={seconds_text(t, hook.timeout_s)} before={previous && was("timeout_s") ? seconds_text(t, previous.timeout_s) : null} />
        {(!hook.enabled || was("enabled")) && <Fact label={t("hooks.state_label")} value={state(hook.enabled)} before={previous && was("enabled") ? state(previous.enabled) : null} />}
      </dl>
      {previous && was("command") ? (
        <div className="edit-card">
          <div className="edit-card-head">
            <span>{shell}</span>
          </div>
          <DiffView lines={command_change(previous.command, hook.command)} />
        </div>
      ) : (
        <div className="command-card">
          <div className="command-card-shell">{shell}</div>
          <PreviewText text={hook.command} prompt="$ " />
        </div>
      )}
    </div>
  );
};
