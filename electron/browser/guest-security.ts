import { app, type OnBeforeRequestListenerDetails, type Session, type WebContents, type WebPreferences } from "electron";
import { is_local_page, is_page_asset } from "../../shared/local-page.ts";
import { crosses_into_files, is_guest_url_allowed, plain_user_agent } from "./guest-policy.ts";

type NavigationEvent = { url: string; isMainFrame: boolean; preventDefault: () => void };

const unsafe_file_frame = (url: string) => /^file:/i.test(url) && !is_local_page(url);

const refused_request = (details: OnBeforeRequestListenerDetails): boolean => {
  if (details.resourceType === "mainFrame") {
    return !is_guest_url_allowed(details.url, true);
  }

  if (!/^file:/i.test(details.url)) {
    return false;
  }

  if (details.resourceType === "xhr") {
    return true;
  }

  if ((details.resourceType === "subFrame" || details.resourceType === "object") && !is_local_page(details.url)) {
    return true;
  }

  return !is_page_asset(details.webContents?.getURL() ?? "", details.url);
};

const block_unsafe_navigation = (contents: WebContents, redirect: boolean) => (event: NavigationEvent) => {
  const refused = event.isMainFrame ? !is_guest_url_allowed(event.url, true) : unsafe_file_frame(event.url);
  const escalates = redirect ? /^file:/i.test(event.url) : crosses_into_files(contents.getURL(), event.url);
  if (refused || escalates) {
    console.warn(`[browser] blocked guest navigation from ${contents.getURL().slice(0, 200)} to ${event.url.slice(0, 200)}`);
    event.preventDefault();
  }
};

export const guest_preferences = (partition: string): WebPreferences => ({
  partition,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  backgroundThrottling: false,
  disableDialogs: true,
  navigateOnDragDrop: false,
});

export const secure_guest = (contents: WebContents, on_popup: (url: string) => void) => {
  contents.setWindowOpenHandler((details) => {
    if (!details.postBody && is_guest_url_allowed(details.url, false) && !crosses_into_files(contents.getURL(), details.url)) {
      on_popup(details.url);
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", block_unsafe_navigation(contents, false));
  contents.on("will-frame-navigate", block_unsafe_navigation(contents, false));
  contents.on("will-redirect", block_unsafe_navigation(contents, true));
};

export const secure_session = (guest_session: Session) => {
  guest_session.setUserAgent(app.userAgentFallback);
  guest_session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  guest_session.setPermissionCheckHandler(() => false);
  guest_session.webRequest.onBeforeRequest((details, callback) => {
    if (refused_request(details)) {
      console.warn(`[browser] blocked ${details.resourceType} request to ${details.url.slice(0, 200)} from ${(details.webContents?.getURL() ?? "").slice(0, 200)}`);
      callback({ cancel: true });
      return;
    }

    callback({});
  });
  guest_session.on("will-download", (_event, item) => {
    console.warn(`[browser] cancelled download of ${item.getFilename()} from ${item.getURL().slice(0, 200)}`);
    item.cancel();
  });
};

export const init_browser_guest_security = () => {
  app.userAgentFallback = plain_user_agent(app.userAgentFallback, app.getName());
};
