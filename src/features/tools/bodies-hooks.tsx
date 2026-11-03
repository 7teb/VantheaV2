import type { ScopedHook } from "../../../shared/hooks.ts";
import { use_t } from "../../i18n/index.ts";
import { settings_store } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";
import type { BodyProps } from "./body-types.ts";
import { HookPreview } from "./HookApproval.tsx";
import { event_label, matcher_text, scope_text } from "./hook-text.ts";
import "./hooks.css";

const scope_key = (hook: ScopedHook): string => (hook.scope.kind === "global" ? "" : hook.scope.path);

type ScopeGroup = { key: string; scope: ScopedHook["scope"]; hooks: ScopedHook[] };

const grouped = (hooks: ScopedHook[]): ScopeGroup[] => {
  const groups = new Map<string, ScopeGroup>();
  for (const hook of hooks) {
    const key = scope_key(hook);
    groups.set(key, { key, scope: hook.scope, hooks: [...(groups.get(key)?.hooks ?? []), hook] });
  }
  return [...groups.values()];
};

const HookList = ({ hooks }: { hooks: ScopedHook[] }) => {
  const t = use_t();
  const projects = use_store(settings_store, (state) => state?.projects ?? []);
  return (
    <ul className="tool-body-list tool-card hook-list">
      {grouped(hooks).map((group) => [
        <li key={`scope:${group.key}`} className="hook-list-scope">
          {scope_text(t, group.scope, projects)}
        </li>,
        ...group.hooks.map((hook) => {
          const matcher = matcher_text(t, hook.event, hook.matcher);
          return (
            <li key={hook.id} className="hook-list-item" data-enabled={hook.enabled}>
              <span className="hook-list-event">{event_label(t, hook.event)}</span>
              {matcher && <span className={matcher.all ? "hook-list-matcher" : "hook-list-matcher tool-body-mono"}>{matcher.text}</span>}
              <span className="hook-list-command tool-body-mono" title={hook.command}>
                {hook.command}
              </span>
              {!hook.enabled && <span className="hook-list-off">{t("hooks.state_off")}</span>}
            </li>
          );
        }),
      ])}
    </ul>
  );
};

export const HooksBody = ({ view }: BodyProps<"hooks">) => {
  const t = use_t();
  const projects = use_store(settings_store, (state) => state?.projects ?? []);
  if (view.action === "list") {
    return <HookList hooks={view.hooks} />;
  }
  const first = view.hooks[0];
  return (
    <HookPreview
      hook={first}
      previous={view.action === "change" ? view.previous : null}
      scope={scope_text(t, first.scope, projects)}
      scope_title={first.scope.kind === "project" ? first.scope.path : ""}
    />
  );
};
