import { EventEmitter } from "node:events";

type Rect = { x: number; y: number; width: number; height: number };

type OpenHandler = (details: { url: string; postBody?: unknown }) => { action: string };

export const created: { windows: FakeBaseWindow[]; views: FakeView[] } = { windows: [], views: [] };

class FakeDebugger extends EventEmitter {
  attached = false;
  commands: string[] = [];
  isAttached() {
    return this.attached;
  }
  attach() {
    this.attached = true;
  }
  detach() {
    this.attached = false;
  }
  sendCommand(method: string) {
    this.commands.push(method);
    return Promise.resolve({});
  }
}

export type FakeImage = {
  isEmpty: () => boolean;
  toJPEG: () => Buffer;
  toPNG: () => Buffer;
  getSize: () => { width: number; height: number };
  crop: () => FakeImage;
  resize: () => FakeImage;
  toBitmap: () => Buffer;
};

const fake_image = (): FakeImage => {
  const image: FakeImage = {
    isEmpty: () => false,
    toJPEG: () => Buffer.from("frame"),
    toPNG: () => Buffer.from("png"),
    getSize: () => ({ width: 800, height: 600 }),
    crop: () => image,
    resize: () => image,
    toBitmap: () => Buffer.alloc(96 * 96 * 4, 128),
  };
  return image;
};

class FakeWebContents extends EventEmitter {
  destroyed = false;
  focused = false;
  url = "";
  title = "";
  zoom = 1;
  loads: string[] = [];
  open_handler: OpenHandler | null = null;
  debugger = new FakeDebugger();
  navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: () => undefined, goForward: () => undefined };
  isDestroyed() {
    return this.destroyed;
  }
  isFocused() {
    return this.focused;
  }
  loadURL(url: string) {
    this.loads.push(url);
    this.url = url;
    return Promise.resolve();
  }
  getURL() {
    return this.url;
  }
  getTitle() {
    return this.title;
  }
  reload() {
    this.loads.push(this.url);
  }
  close() {
    this.destroyed = true;
    this.emit("destroyed");
  }
  setWindowOpenHandler(handler: OpenHandler) {
    this.open_handler = handler;
  }
  getZoomFactor() {
    return this.zoom;
  }
  capturePage() {
    return Promise.resolve(fake_image());
  }
}

class FakeContentView {
  children: FakeView[] = [];
  addChildView(view: FakeView) {
    view.parent?.removeChildView(view);
    this.children.push(view);
    view.parent = this;
  }
  removeChildView(view: FakeView) {
    this.children = this.children.filter((child) => child !== view);
    if (view.parent === this) {
      view.parent = null;
    }
  }
}

export class FakeView extends EventEmitter {
  webContents = new FakeWebContents();
  bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  radius = 0;
  parent: FakeContentView | null = null;
  options: unknown;
  constructor(options: unknown) {
    super();
    this.options = options;
    created.views.push(this);
  }
  setBounds(bounds: Rect) {
    this.bounds = bounds;
  }
  setBorderRadius(radius: number) {
    this.radius = radius;
  }
}

export class FakeBaseWindow extends EventEmitter {
  contentView = new FakeContentView();
  options: Record<string, unknown>;
  bounds: Rect;
  destroyed = false;
  visible = false;
  minimized = false;
  opacity = 1;
  ignores_mouse = false;
  constructor(options: Record<string, unknown>) {
    super();
    this.options = options;
    this.visible = Boolean(options.show);
    this.bounds = { x: Number(options.x ?? 0), y: Number(options.y ?? 0), width: Number(options.width ?? 0), height: Number(options.height ?? 0) };
    created.windows.push(this);
  }
  showInactive() {
    this.visible = true;
  }
  setOpacity(value: number) {
    this.opacity = value;
  }
  setIgnoreMouseEvents(value: boolean) {
    this.ignores_mouse = value;
  }
  setContentBounds(bounds: Rect) {
    this.bounds = bounds;
  }
  getContentSize() {
    return [this.bounds.width, this.bounds.height];
  }
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return this.minimized;
  }
  destroy() {
    this.destroyed = true;
    this.emit("closed");
  }
}

export class FakeBrowserWindow extends FakeBaseWindow {
  webContents = new FakeWebContents();
}

export class FakeSession {
  partition: string;
  secured = 0;
  wipes = 0;
  auth_wipes = 0;
  wipe_gate: Promise<void> = Promise.resolve();
  constructor(partition: string) {
    this.partition = partition;
  }
  setUserAgent() {
    this.secured += 1;
  }
  setPermissionRequestHandler() {}
  setPermissionCheckHandler() {}
  webRequest = { onBeforeRequest: () => undefined };
  on() {}
  clearData() {
    this.wipes += 1;
    return this.wipe_gate;
  }
  clearAuthCache() {
    this.auth_wipes += 1;
    return Promise.resolve();
  }
}

export const sessions = new Map<string, FakeSession>();

const from_partition = (partition: string) => {
  const known = sessions.get(partition);
  if (known) {
    return known;
  }
  const created_session = new FakeSession(partition);
  sessions.set(partition, created_session);
  return created_session;
};

export type MessageBoxCall = { window: unknown; options: { buttons: string[]; message: string; defaultId: number; cancelId: number } };

export const message_boxes: { calls: MessageBoxCall[]; answer: number } = { calls: [], answer: 0 };

export const displays: { bounds: Rect }[] = [
  { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
  { bounds: { x: 0, y: -200, width: 2560, height: 1440 } },
];

export const BaseWindow = FakeBaseWindow;
export const BrowserWindow = FakeBrowserWindow;
export const WebContentsView = FakeView;
export const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => displays });
export const app = { userAgentFallback: "Mozilla/5.0", getName: () => "VantheaX", getAppPath: () => "", on: () => undefined };
export const session = { fromPartition: from_partition };
export const ipcMain = { handle: () => undefined, on: () => undefined };
export const ipcRenderer = {};
export const contextBridge = {};
export const webUtils = {};
export const shell = {};
export const Menu = {};
export const dialog = {
  showMessageBoxSync: (window: unknown, options: MessageBoxCall["options"]) => {
    message_boxes.calls.push({ window, options });
    return message_boxes.answer;
  },
};
export const nativeImage = {};
export const powerSaveBlocker = {};
export const protocol = {};
export const safeStorage = {};
