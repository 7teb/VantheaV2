import { app, session, type WebContents } from "electron";
import { emit } from "../ipc/handle.ts";
import { browser_partition, is_guest_url_allowed, plain_user_agent } from "./guest-policy.ts";

const browser_session = () => session.fromPartition(browser_partition);

const block_unsafe_navigation = (event: { url: string; isMainFrame: boolean; preventDefault: () => void }) => {
  if (event.isMainFrame && !is_guest_url_allowed(event.url, true)) {
    console.warn(`[browser] blocked guest navigation to ${event.url.slice(0, 200)}`);
    event.preventDefault();
  }
};

const secure_guest = (contents: WebContents) => {
  if (contents.session !== browser_session()) {
    console.warn("[browser] closed a webview that does not use the browser partition");
    contents.close();
    return;
  }
  contents.setWindowOpenHandler((details) => {
    if (!details.postBody && is_guest_url_allowed(details.url, false)) {
      emit("browser:popup", { url: details.url });
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", block_unsafe_navigation);
  contents.on("will-frame-navigate", block_unsafe_navigation);
  contents.on("will-redirect", block_unsafe_navigation);
};

const secure_host = (contents: WebContents) => {
  contents.on("will-attach-webview", (event, preferences, params) => {
    if (params.partition !== browser_partition || !is_guest_url_allowed(params.src ?? "", true)) {
      console.warn(`[browser] refused a webview with partition ${params.partition} and src ${String(params.src).slice(0, 200)}`);
      event.preventDefault();
      return;
    }
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInWorker = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    preferences.webSecurity = true;
    preferences.allowRunningInsecureContent = false;
    preferences.experimentalFeatures = false;
    preferences.webviewTag = false;
  });
};

const configure_session = () => {
  const guest_session = browser_session();
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
  configure_session();
  app.on("web-contents-created", (_event, contents) => {
    const type = contents.getType();
    if (type === "webview") {
      secure_guest(contents);
    } else if (type === "window") {
      secure_host(contents);
    }
  });
};

export const wipe_browser_storage = () => browser_session().clearStorageData();
