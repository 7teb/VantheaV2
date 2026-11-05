import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { decode_wire, encode_wire } from "../shared/remote-wire.ts";

const stubs: Record<string, string> = {
  electron: [
    "export const ipcMain = { handle: () => {}, on: () => {} };",
    "export const app = { getAppPath: () => process.env.VX_REMOTE_TEST_APP, getPath: () => process.env.VX_REMOTE_TEST_APP };",
    "export const protocol = { handle: () => {} };",
    "export const shell = {};",
  ].join("\n"),
  window: "export const main_window = () => null;",
};

const server_stubs: Plugin = {
  name: "server-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]app[\\/]window\.ts$/ }, () => ({ path: "window", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js", resolveDir: process.cwd() }));
  },
};

export type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

export type Frame = { id: string | null; n: string; p?: any };

export type EventStream = { frames: Frame[]; wait: (count: number) => Promise<Frame[]>; ended: Promise<void>; close: () => void; status: number };

export const page = "Page1Page1Page1Page1Pa";

export const kit = {
  vx: null as any,
  root: "",
  port: 0,
  first_port: 0,
  cookie: "",
  blocker: null as net.Server | null,
  calls: [] as { channel: string; client: string; args: unknown[] }[],
};

export const fake_codec = (available: boolean) => ({
  available: () => available,
  encrypt: (plain: string) => {
    if (!available) {
      throw new Error("encryption unavailable");
    }
    return Buffer.from(`enc:${plain}`).toString("base64");
  },
  decrypt: (cipher: string) => Buffer.from(cipher, "base64").toString("utf8").slice(4),
});

export const settings_files = () => ({
  settings: path.join(kit.root, "v2", "settings.json"),
  secrets: path.join(kit.root, "v2", "secrets.json"),
  legacy_settings: path.join(kit.root, "settings.json"),
});

export const request = (options: { method?: string; target: string; headers?: Record<string, string>; body?: string | Buffer; host?: string }) =>
  new Promise<Reply>((resolve, reject) => {
    const outgoing = http.request(
      { host: "127.0.0.1", port: kit.port, agent: false, method: options.method ?? "GET", path: options.target, headers: { Host: options.host ?? `127.0.0.1:${kit.port}`, ...options.headers } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });

export const rpc_headers = (extra: Record<string, string> = {}): Record<string, string> => ({
  Origin: `http://127.0.0.1:${kit.port}`,
  "Content-Type": "application/json",
  "X-VX-Client": page,
  Cookie: kit.cookie,
  ...extra,
});

export const rpc = (channel: string, args: unknown[], headers: Record<string, string> = {}) =>
  request({ method: "POST", target: "/rpc", headers: rpc_headers(headers), body: encode_wire({ channel, args }) });

const parse_block = (block: string): Frame | null => {
  const lines = block.split("\n");
  const id = lines.find((line) => line.startsWith("id: "));
  const data = lines.find((line) => line.startsWith("data: "));
  return data ? { id: id ? id.slice(4) : null, ...(decode_wire(data.slice(6)) as { n: string; p?: unknown }) } : null;
};

export const open_events = (client: string, extra = "", headers: Record<string, string> = { Cookie: kit.cookie }) =>
  new Promise<EventStream>((resolve, reject) => {
    const outgoing = http.get(
      { host: "127.0.0.1", port: kit.port, agent: false, path: `/events?client=${client}${extra}`, headers: { Host: `127.0.0.1:${kit.port}`, ...headers } },
      (response) => {
        const frames: Frame[] = [];
        let buffer = "";
        let waiter: (() => void) | null = null;
        const ended = new Promise<void>((done) => response.on("close", () => done()));
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          buffer += chunk;
          for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
            const frame = parse_block(buffer.slice(0, end));
            buffer = buffer.slice(end + 2);
            if (frame) {
              frames.push(frame);
            }
          }
          waiter?.();
        });
        const wait = (count: number) =>
          new Promise<Frame[]>((done, fail) => {
            const timer = setTimeout(() => fail(new Error(`expected ${count} frames, got ${JSON.stringify(frames)}`)), 3000);
            const check = () => {
              if (frames.length >= count) {
                clearTimeout(timer);
                waiter = null;
                done(frames);
              }
            };
            waiter = check;
            check();
          });
        resolve({ frames, wait, ended, close: () => outgoing.destroy(), status: response.statusCode ?? 0 });
      },
    );
    outgoing.on("error", reject);
  });

export const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

const port_free = (candidate: number) =>
  new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(candidate, "127.0.0.1", () => probe.close(() => resolve(true)));
  });

const free_port = async () => {
  for (let candidate = 48000 + Math.floor(Math.random() * 1500); candidate < 49900; candidate += 1) {
    if ((await port_free(candidate)) && (await port_free(candidate + 1))) {
      return candidate;
    }
  }
  throw new Error("no free test port between 48000 and 49900");
};

const write_bundle = async () => {
  await fs.mkdir(path.join(kit.root, "dist", "assets"), { recursive: true });
  await fs.mkdir(path.join(kit.root, "v2"), { recursive: true });
  await fs.writeFile(path.join(kit.root, "dist", "index.html"), "<!doctype html><title>app</title>");
  await fs.writeFile(path.join(kit.root, "dist", "visual-frame.html"), "<!doctype html><title>frame</title>");
  await fs.writeFile(path.join(kit.root, "dist", "assets", "app-1.js"), "console.log(1)");
  await fs.writeFile(path.join(kit.root, "dist", "notes.txt"), "plain text is not served");
  await fs.writeFile(path.join(kit.root, "secret.txt"), "outside the bundle");
};

const register_handlers = () => {
  const { vx, calls } = kit;
  vx.handle_client("chats:search", (client: string, query: string) => {
    calls.push({ channel: "chats:search", client, args: [query] });
    return [{ client, query }];
  });
  vx.handle("attachments:save", (upload: { bytes: Uint8Array }) => ({ bytes: upload.bytes instanceof Uint8Array, size: upload.bytes.length }));
  vx.handle("chats:get", () => {
    throw new Error("chat x not found");
  });
  vx.handle("window:close", () => {
    calls.push({ channel: "window:close", client: "", args: [] });
  });
  vx.listen_client("terminal:input", (client: string, ...args: unknown[]) => calls.push({ channel: "terminal:input", client, args }));
};

export const pair_cookie = async (token: string) => {
  const reply = await request({ target: `/pair?t=${token}` });
  assert.equal(reply.status, 303);
  return (reply.headers["set-cookie"]?.[0] ?? "").split(";")[0];
};

export const start_kit = async (paired: boolean) => {
  kit.root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-remote-"));
  await write_bundle();
  process.env.VX_REMOTE_TEST_APP = kit.root;
  const result = await build({
    stdin: {
      contents: [
        'export { set_remote_enabled, renew_remote_link, remote_status, start_listeners, on_remote_change } from "./electron/remote/server.ts";',
        'export { emit, emit_to, handle, handle_client, listen_client } from "./electron/ipc/handle.ts";',
        'export { client_connected, known_clients } from "./electron/ipc/clients.ts";',
        'export { current_token } from "./electron/remote/auth.ts";',
        'export { init_settings } from "./electron/settings/store.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [server_stubs],
    logLevel: "silent",
  });
  kit.vx = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  await kit.vx.init_settings({ files: settings_files(), codec: fake_codec(true), on_change: () => {} });
  register_handlers();
  kit.first_port = await free_port();
  const blocker = net.createServer();
  kit.blocker = blocker;
  await new Promise<void>((resolve) => blocker.listen(kit.first_port, "127.0.0.1", resolve));
  await kit.vx.start_listeners([{ interface: "loopback", address: "127.0.0.1" }], kit.first_port);
  kit.port = kit.vx.remote_status().port;
  if (paired) {
    kit.cookie = await pair_cookie(kit.vx.current_token());
  }
};

export const stop_kit = async () => {
  await kit.vx.set_remote_enabled(false);
  kit.blocker?.close();
  await fs.rm(kit.root, { recursive: true, force: true });
};
