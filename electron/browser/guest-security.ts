import { app, type Session, type WebContents, type WebPreferences } from "electron";
import { is_guest_url_allowed, plain_user_agent } from "./guest-policy.ts";

const block_unsafe_navigation = (event: { url: string; isMainFrame: boolean; preventDefault: () => void }) => {
  if (event.isMainFrame && !is_guest_url_allowed(event.url, true)) {
    console.warn(`[browser] blocked guest navigation to ${event.url.slice(0, 200)}`);
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
    if (!details.postBody && is_guest_url_allowed(details.url, false)) {
      on_popup(details.url);
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", block_unsafe_navigation);
  contents.on("will-frame-navigate", block_unsafe_navigation);
  contents.on("will-redirect", block_unsafe_navigation);
};

export const secure_session = (guest_session: Session) => {
  guest_session.setUserAgent(app.userAgentFallback);
  guest_session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  guest_session.setPermissionCheckHandler(() => false);
  guest_session.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === "mainFrame" && !is_guest_url_allowed(details.url, true)) {
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
