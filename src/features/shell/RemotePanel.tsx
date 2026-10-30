import { useState } from "react";
import type { RemoteFailure, RemoteLink, RemoteStatus } from "../../../shared/ipc/remote.ts";
import { Button } from "../../components/Button.tsx";
import { CheckIcon, RetryIcon } from "../../components/icons.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { Toggle } from "../../components/Toggle.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_t, type Translate } from "../../i18n/index.ts";
import { remote_store, renew_remote_link, set_remote_enabled } from "../../state/remote.ts";
import { use_store } from "../../state/use-store.ts";
import { RemoteQr } from "./RemoteQr.tsx";

const failure_text = (t: Translate, failure: RemoteFailure) => {
  switch (failure.kind) {
    case "no_network":
      return t("remote.failed_no_network");
    case "no_port":
      return t("remote.failed_no_port");
    case "secret_storage":
      return t("remote.failed_secret_storage");
    case "failed":
      return t("remote.failed", { detail: failure.detail });
  }
};

const connected_text = (t: Translate, count: number) => {
  if (count === 0) {
    return t("remote.connected_none");
  }
  return count === 1 ? t("remote.connected_one") : t("remote.connected_other", { n: count });
};

const LinkText = ({ link }: { link: RemoteLink }) => (
  <span className="remote-link-text">
    <span className="remote-link-name">{link.interface}</span>
    <span className="remote-link-url">{link.url}</span>
  </span>
);

type LinkListProps = { links: RemoteLink[]; selected: number; on_select: (index: number) => void };

const LinkList = ({ links, selected, on_select }: LinkListProps) => {
  const t = use_t();
  if (links.length === 1) {
    return (
      <div className="remote-links">
        <div className="remote-link">
          <LinkText link={links[0]} />
        </div>
      </div>
    );
  }
  return (
    <div className="remote-links" role="radiogroup" aria-label={t("remote.address")}>
      {links.map((link, index) => (
        <button
          key={link.url}
          type="button"
          role="radio"
          aria-checked={index === selected}
          className="remote-link"
          onClick={() => on_select(index)}
        >
          <LinkText link={link} />
          <span className="remote-link-check">{index === selected && <CheckIcon size={14} />}</span>
        </button>
      ))}
    </div>
  );
};

const RemoteOn = ({ status }: { status: RemoteStatus }) => {
  const t = use_t();
  const [selected, set_selected] = useState(0);
  const index = Math.min(selected, status.links.length - 1);
  const link = status.links[index];
  return (
    <>
      <div className="remote-code">
        <RemoteQr text={link.pairing_url} label={t("remote.scan")} />
        <span className="remote-caption">{t("remote.scan")}</span>
      </div>
      <LinkList links={status.links} selected={index} on_select={set_selected} />
      <p className="remote-hint">{t("remote.firewall_hint")}</p>
      <div className="remote-foot">
        <span className="remote-count">{connected_text(t, status.connected)}</span>
        <Tooltip label={t("remote.new_link_hint")}>
          <Button size="sm" icon={<RetryIcon size={14} />} onClick={() => void renew_remote_link()}>
            {t("remote.new_link")}
          </Button>
        </Tooltip>
      </div>
    </>
  );
};

export const RemotePanel = () => {
  const t = use_t();
  const status = use_store(remote_store, (value) => value);
  const state = status?.state ?? "off";
  return (
    <div className="remote-panel">
      <div className="remote-head">
        <span className="remote-title">{t("remote.title")}</span>
        <Toggle
          checked={state === "on" || state === "starting"}
          label={t("remote.toggle")}
          disabled={status === null}
          on_change={(enabled) => void set_remote_enabled(enabled)}
        />
      </div>
      {state === "starting" && (
        <div className="remote-code">
          <Skeleton width={176} height={176} radius={12} />
        </div>
      )}
      {status?.state === "on" && <RemoteOn status={status} />}
      {status?.state === "failed" && status.failure && <p className="remote-failure">{failure_text(t, status.failure)}</p>}
    </div>
  );
};
