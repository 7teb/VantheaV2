import http from "node:http";
import type { RemoteFailure, RemoteLink, RemoteStatus } from "../../shared/ipc/remote.ts";
import { pair_path } from "../../shared/remote-wire.ts";
import { secret_storage_available } from "../settings/store.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { primary_first, primary_ipv4, private_ipv4_links, type LanAddress } from "./addresses.ts";
import { current_token, ensure_token, renew_token } from "./auth.ts";
import { connected_count, revoke_streams, start_hub, stop_hub } from "./events.ts";
import { route, set_allowed_hosts } from "./router.ts";

export const remote_port_start = 47820;

export const remote_port_end = 49999;

type Bound = { port: number; servers: http.Server[]; addresses: LanAddress[] };

class StartFailure extends Error {
  readonly failure: RemoteFailure;

  constructor(failure: RemoteFailure) {
    super(`LAN server failure ${failure.kind}`);
    this.failure = failure;
  }
}

const off_status: RemoteStatus = { state: "off", port: null, links: [], connected: 0, failure: null };

let status: RemoteStatus = off_status;
let bound: Bound | null = null;
let queue: Promise<void> = Promise.resolve();
const listeners: ((status: RemoteStatus) => void)[] = [];

const publish = (patch: Partial<RemoteStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((listener, index) => {
    try {
      listener(status);
    } catch (error) {
      console.error(`[remote] status listener ${index} failed:`, error);
    }
  });
};

export const remote_status = (): RemoteStatus => status;

export const on_remote_change = (listener: (status: RemoteStatus) => void): void => {
  listeners.push(listener);
};

const links_of = ({ port, addresses }: Bound): RemoteLink[] =>
  addresses.map((link) => ({
    interface: link.interface,
    address: link.address,
    url: `http://${link.address}:${port}/`,
    pairing_url: `http://${link.address}:${port}${pair_path}?t=${current_token()}`,
  }));

const close_servers = async (servers: http.Server[]): Promise<void> => {
  const closed = servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())));
  for (const server of servers) {
    server.closeAllConnections();
  }
  await Promise.all(closed);
};

const listen_once = (server: http.Server, host: string, port: number) =>
  new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      server.off("listening", listening);
      reject(error);
    };
    const listening = () => {
      server.off("error", failed);
      resolve();
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen({ host, port, exclusive: true });
  });

const bind_port = async (addresses: LanAddress[], port: number): Promise<http.Server[] | null> => {
  const servers: http.Server[] = [];
  try {
    for (const link of addresses) {
      const server = http.createServer(route);
      servers.push(server);
      await listen_once(server, link.address, port);
    }
    return servers;
  } catch (error) {
    await close_servers(servers);
    const code = error_code(error);
    if (code === "EADDRINUSE" || code === "EACCES") {
      return null;
    }
    throw new StartFailure({ kind: "failed", detail: `listening on port ${port} failed: ${error_text(error)}` });
  }
};

export const start_listeners = async (addresses: LanAddress[], first_port = remote_port_start): Promise<void> => {
  await ensure_token();
  for (let port = first_port; port <= remote_port_end; port += 1) {
    const servers = await bind_port(addresses, port);
    if (!servers) {
      continue;
    }
    for (const server of servers) {
      server.on("error", (error) => console.error(`[remote] the LAN server on port ${port} failed:`, error));
    }
    bound = { port, servers, addresses };
    set_allowed_hosts(addresses.map((link) => `${link.address}:${port}`));
    start_hub((connected) => publish({ connected }));
    publish({ state: "on", port, links: links_of(bound), connected: connected_count(), failure: null });
    return;
  }
  throw new StartFailure({ kind: "no_port" });
};

const open = async () => {
  if (status.state === "on") {
    return;
  }
  publish({ ...off_status, state: "starting" });
  try {
    if (!secret_storage_available()) {
      throw new StartFailure({ kind: "secret_storage" });
    }
    const links = private_ipv4_links();
    if (!links.length) {
      throw new StartFailure({ kind: "no_network" });
    }
    await start_listeners(primary_first(links, await primary_ipv4()));
  } catch (error) {
    console.error("[remote] starting the LAN server failed:", error);
    publish({ ...off_status, state: "failed", failure: error instanceof StartFailure ? error.failure : { kind: "failed", detail: error_text(error) } });
  }
};

const release = (): http.Server[] => {
  stop_hub();
  const servers = bound?.servers ?? [];
  bound = null;
  set_allowed_hosts([]);
  return servers;
};

const close = async () => {
  await close_servers(release());
  publish(off_status);
};

const renew = async () => {
  await renew_token();
  if (!bound) {
    return;
  }
  revoke_streams();
  publish({ links: links_of(bound), connected: connected_count() });
};

const serialize = (step: string, action: () => Promise<void> | void): Promise<RemoteStatus> => {
  const run = queue.then(action);
  queue = run.catch((error: unknown) => console.error(`[remote] ${step} failed:`, error));
  return run.then(() => status);
};

export const set_remote_enabled = (enabled: boolean): Promise<RemoteStatus> => serialize(enabled ? "starting the LAN server" : "stopping the LAN server", enabled ? open : close);

export const renew_remote_link = (): Promise<RemoteStatus> => serialize("renewing the pairing link", renew);

export const shutdown_remote = (): void => {
  if (!bound) {
    return;
  }
  close_servers(release()).catch((error) => console.error("[remote] closing the LAN server at shutdown failed:", error));
};
