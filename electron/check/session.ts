import { session, type CustomScheme, type Session } from "electron";
import { serve_check_request } from "./serve.ts";

export const check_partition = "vx-check";

export const check_scheme: CustomScheme = { scheme: "vx-check", privileges: { standard: true, secure: true, supportFetchAPI: true } };

const font_hosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

let configured: Session | null = null;

let blocked_listener: ((url: string) => void) | null = null;

const allowed_request = (raw: string): boolean => {
  if (!URL.canParse(raw)) {
    return false;
  }
  const url = new URL(raw);
  if (url.protocol === `${check_scheme.scheme}:` || url.protocol === "data:" || url.protocol === "blob:") {
    return true;
  }
  return url.protocol === "https:" && font_hosts.has(url.hostname);
};

const configure = (ses: Session) => {
  ses.protocol.handle(check_scheme.scheme, serve_check_request);
  ses.setPermissionRequestHandler((...[, permission, callback]) => {
    console.warn(`[check] refused the permission request ${permission} of a checked page`);
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (...[, item]) => {
    console.warn(`[check] cancelled download of ${item.getFilename()} from ${item.getURL().slice(0, 200)}`);
    item.cancel();
  });
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (allowed_request(details.url)) {
      callback({});
      return;
    }
    blocked_listener?.(details.url);
    callback({ cancel: true });
  });
};

export const check_session = (): Session => {
  if (configured) {
    return configured;
  }
  const ses = session.fromPartition(check_partition);
  configure(ses);
  configured = ses;
  return ses;
};

export const listen_blocked = (listener: ((url: string) => void) | null) => {
  blocked_listener = listener;
};
