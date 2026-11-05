import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fake_codec, kit, open_events, page, pair_cookie, request, rpc, settings_files, settle, start_kit, stop_kit } from "./remote-server-kit.ts";

before(() => start_kit(true));

after(stop_kit);

test("events fan out to every stream, targeted events reach one page and hidden ones none", async () => {
  const other_page = "Page2Page2Page2Page2Pa";
  const first = await open_events(page);
  const second = await open_events(other_page);
  assert.equal(first.status, 200);
  const [hello] = await first.wait(1);
  assert.equal(hello.n, "vx:hello");
  assert.match(String(hello.id), /^[0-9a-f]{12}\.\d+$/);
  await second.wait(1);
  const session = kit.cookie.split("=")[1].split(".")[0];
  assert.equal(kit.vx.client_connected(`remote:${session}.${page}`), true);
  kit.vx.emit("window:changed", { maximized: true, fullscreen: false, focused: true, zoom: 0 });
  kit.vx.emit("remote:changed", kit.vx.remote_status());
  kit.vx.emit("browser:changed", { chat_id: "", tabs: [], active_id: "" });
  kit.vx.emit("chats:removed", { chat_id: "c1" });
  kit.vx.emit_to(`remote:${session}.${other_page}`, "terminal:data", { terminal_id: "t2", data: "only second" });
  kit.vx.emit_to("window", "terminal:data", { terminal_id: "t0", data: "only window" });
  kit.vx.emit("artifacts:changed", { project_path: "p" });
  const frames = await first.wait(3);
  assert.deepEqual(
    frames.slice(1).map((frame) => frame.n),
    ["chats:removed", "artifacts:changed"],
  );
  assert.deepEqual(frames[1].p, { chat_id: "c1" });
  const seconds = await second.wait(4);
  assert.deepEqual(
    seconds.slice(1).map((frame) => [frame.n, frame.p.data ?? frame.p.chat_id ?? frame.p.project_path]),
    [
      ["chats:removed", "c1"],
      ["terminal:data", "only second"],
      ["artifacts:changed", "p"],
    ],
  );
  first.close();
  second.close();
  await first.ended;
  await settle();
  assert.equal(kit.vx.client_connected(`remote:${session}.${page}`), false);
});

test("a reconnect replays missed events and an unusable id asks for a resync", async () => {
  const live = await open_events(page);
  const [hello] = await live.wait(1);
  kit.vx.emit("chats:removed", { chat_id: "seen" });
  const [, seen] = await live.wait(2);
  live.close();
  await live.ended;
  kit.vx.emit("chats:removed", { chat_id: "missed-1" });
  kit.vx.emit("chats:removed", { chat_id: "missed-2" });
  const resumed = await open_events(page, `&last=${seen.id}`);
  const replay = await resumed.wait(3);
  assert.equal(replay[0].n, "vx:hello");
  assert.equal(replay[0].id, seen.id);
  assert.deepEqual(
    replay.slice(1).map((frame) => frame.p.chat_id),
    ["missed-1", "missed-2"],
  );
  resumed.close();
  const boot = String(hello.id).split(".")[0];
  for (const last of ["000000000000.1", `${boot}.999999`, "garbage"]) {
    const stale = await open_events(page, `&last=${last}`);
    const frames = await stale.wait(2);
    assert.equal(frames[1].n, "vx:resync", last);
    stale.close();
  }
  const by_header = await open_events(page, "", { Cookie: kit.cookie, "Last-Event-ID": String(hello.id) });
  const header_frames = await by_header.wait(4);
  assert.deepEqual(
    header_frames.slice(1).map((frame) => frame.p.chat_id),
    ["seen", "missed-1", "missed-2"],
  );
  by_header.close();
  assert.equal((await request({ target: "/events?client=bad", headers: { Cookie: kit.cookie } })).status, 400);
});

test("a new page of a session retires that session's idle pages but not its open ones", async () => {
  const session = kit.cookie.split("=")[1].split(".")[0];
  const client = (name: string) => `remote:${session}.${name}`;
  const idle = await open_events("IdlePageIdlePageIdle01");
  await idle.wait(1);
  idle.close();
  await idle.ended;
  await settle();
  assert.ok(kit.vx.known_clients().includes(client("IdlePageIdlePageIdle01")));
  const open = await open_events("OpenPageOpenPageOpen01");
  await open.wait(1);
  assert.equal(kit.vx.known_clients().includes(client("IdlePageIdlePageIdle01")), false);
  const next = await open_events("NextPageNextPageNext01");
  await next.wait(1);
  assert.ok(kit.vx.known_clients().includes(client("OpenPageOpenPageOpen01")));
  assert.ok(kit.vx.client_connected(client("OpenPageOpenPageOpen01")));
  open.close();
  next.close();
});

test("a new link unpairs every device and closes its open streams", async (t) => {
  t.mock.method(console, "warn", () => {});
  const stream = await open_events(page);
  await stream.wait(1);
  const old_token = kit.vx.current_token();
  const status = await kit.vx.renew_remote_link();
  assert.notEqual(kit.vx.current_token(), old_token);
  assert.equal(status.links[0].pairing_url, `http://127.0.0.1:${kit.port}/pair?t=${kit.vx.current_token()}`);
  await stream.ended;
  assert.equal((await rpc("chats:search", ["x"])).status, 401);
  assert.equal((await request({ target: "/", headers: { Cookie: kit.cookie } })).status, 401);
  assert.equal((await request({ target: `/pair?t=${old_token}` })).status, 401);
  kit.cookie = await pair_cookie(kit.vx.current_token());
  assert.equal((await rpc("chats:search", ["x"])).status, 200);
});

test("turning the server off closes streams and refuses connections", async () => {
  const stream = await open_events(page);
  await stream.wait(1);
  const changes: string[] = [];
  kit.vx.on_remote_change((status: { state: string }) => changes.push(status.state));
  const status = await kit.vx.set_remote_enabled(false);
  assert.equal(status.state, "off");
  assert.deepEqual(status.links, []);
  assert.equal(changes.at(-1), "off");
  assert.ok(
    changes.every((state) => state === "off"),
    changes.join(","),
  );
  await stream.ended;
  await assert.rejects(request({ target: "/", headers: { Cookie: kit.cookie } }), /ECONNREFUSED/);
});

test("without OS encryption the server does not start and stores no plain token", async (t) => {
  t.mock.method(console, "error", () => {});
  await kit.vx.init_settings({ files: settings_files(), codec: fake_codec(false), on_change: () => {} });
  const status = await kit.vx.set_remote_enabled(true);
  assert.equal(status.state, "failed");
  assert.deepEqual(status.failure, { kind: "secret_storage" });
  assert.deepEqual(status.links, []);
  const secrets = await fs.readFile(path.join(kit.root, "v2", "secrets.json"), "utf8");
  assert.ok(!secrets.includes(kit.vx.current_token()));
});
