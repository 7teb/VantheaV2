import type { GitHostKind } from "../git-view.ts";

export type RemoteUrl = { scheme: string | null; host: string | null; host_kind: GitHostKind; slug: string | null; user: string | null; port: number | null };

const github_hosts = new Set(["github.com", "www.github.com", "ssh.github.com"]);

export const strip_userinfo = (text: string): string => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/\s]*@/gi, "$1");

export const host_kind_of = (host: string): GitHostKind => {
  if (github_hosts.has(host)) return "github";
  if (host.endsWith(".ghe.com")) return "ghe_com";
  return "other";
};

const slug_of = (path: string): string | null => {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(trimmed);
  return match ? `${match[1]}/${match[2]}` : null;
};

type HostParts = { scheme: string; host: string; path: string; user: string | null; port: number | null };

const hosted = ({ scheme, host: raw_host, path, user, port }: HostParts): RemoteUrl => {
  const host = raw_host.toLowerCase();
  if (!host) {
    return { scheme, host: null, host_kind: "other", slug: null, user: null, port: null };
  }
  return { scheme, host, host_kind: host_kind_of(host), slug: slug_of(path), user, port };
};

const ssh_user = (scheme: string, user: string | undefined): string | null => (scheme === "ssh" && user && !user.includes(":") ? user : null);

const helper_form = /^([a-z][a-z0-9+.-]*)::(.*)$/is;

const url_scheme = /^([a-z][a-z0-9+.-]*):\/\//i;

export const parse_remote_url = (url: string): RemoteUrl => {
  const value = url.trim();
  if (helper_form.test(value)) {
    return { scheme: null, host: null, host_kind: "helper", slug: null, user: null, port: null };
  }
  const scheme = url_scheme.exec(value)?.[1]?.toLowerCase();
  if (scheme === "file") {
    return { scheme, host: null, host_kind: "local", slug: null, user: null, port: null };
  }
  if (scheme) {
    const parts = /^[^:]+:\/\/(?:([^@/]*)@)?([^/:?#]*)(?::(\d*))?(\/[^?#]*)?/.exec(value);
    const port = parts?.[3] ? Number(parts[3]) : null;
    return hosted({ scheme, host: parts?.[2] ?? "", path: parts?.[4] ?? "", user: ssh_user(scheme, parts?.[1]), port });
  }
  const scp = /^(?:([^@/:]+)@)?([^/:]{2,}):(.+)$/.exec(value);
  if (scp) {
    return hosted({ scheme: "ssh", host: scp[2] ?? "", path: scp[3] ?? "", user: scp[1] ?? null, port: null });
  }
  return { scheme: null, host: null, host_kind: "local", slug: null, user: null, port: null };
};

export const transport_scheme = (url: string): string | null => {
  const helper = helper_form.exec(url.trim());
  if (!helper) return parse_remote_url(url).scheme;
  const address_scheme = url_scheme.exec(helper[2] ?? "")?.[1];
  return (address_scheme ?? helper[1] ?? "").toLowerCase();
};
