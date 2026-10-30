import { remote_client } from "../../api/bridge.ts";
import { DotSpinner } from "../../components/DotSpinner.tsx";
import { use_t } from "../../i18n/index.ts";
import { remote_connection_store } from "../../state/remote-connection.ts";
import { use_store } from "../../state/use-store.ts";
import "./RemoteConnection.css";

export const RemoteConnection = () => {
  const t = use_t();
  const state = use_store(remote_connection_store, (value) => value);
  if (!remote_client || state === "live") {
    return null;
  }
  return (
    <span className="remote-connection" data-state={state} role="status">
      {state === "connecting" && <DotSpinner />}
      <span className="remote-connection-text">{t(state === "connecting" ? "remote.connecting" : "remote.offline")}</span>
    </span>
  );
};
