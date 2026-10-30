import { emit, invoke } from "./channel.ts";

export type RemoteLink = { interface: string; address: string; url: string; pairing_url: string };

export type RemoteFailure = { kind: "no_network" } | { kind: "no_port" } | { kind: "secret_storage" } | { kind: "failed"; detail: string };

export type RemoteStatus = {
  state: "off" | "starting" | "on" | "failed";
  port: number | null;
  links: RemoteLink[];
  connected: number;
  failure: RemoteFailure | null;
};

export const remote_channels = {
  "remote:status": invoke<[], RemoteStatus>(),
  "remote:set_enabled": invoke<[enabled: boolean], RemoteStatus>(),
  "remote:renew_link": invoke<[], RemoteStatus>(),
  "remote:changed": emit<RemoteStatus>(),
} as const;
