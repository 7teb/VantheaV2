type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

export const handlers = new Map<string, Handler>();

export const sent: [string, unknown][] = [];

const frame = {};

export const fake_window = {
  on: () => undefined,
  off: () => undefined,
  isDestroyed: () => false,
  isFocused: () => false,
  webContents: { mainFrame: frame, send: (name: string, payload: unknown) => sent.push([name, payload]) },
};

export const trusted_event = { sender: fake_window.webContents, senderFrame: frame };

export const ipcMain = {
  handle: (name: string, handler: Handler) => handlers.set(name, handler),
  on: () => undefined,
};

export const main_window = () => fake_window;

export const parse_scope = (value: unknown) => {
  const scope = value as { chat_id: string | null; project_path: string };
  if (typeof scope?.project_path !== "string") throw new Error("files scope must be an object");
  return scope;
};

export const require_root = async (scope: { project_path: string }) => scope.project_path;
