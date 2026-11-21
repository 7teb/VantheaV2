import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { ApiEvent } from "../shared/api/contract.ts";
import { events, parse_sse, to_api_event, type SseFrame } from "../sdk/events.ts";
import { VantheaxError } from "../sdk/http.ts";

const chunks_of = async function* (parts: (string | Uint8Array)[]): AsyncGenerator<string | Uint8Array> {
  for (const part of parts) {
    yield part;
  }
};

const collect = async (parts: (string | Uint8Array)[]): Promise<SseFrame[]> => {
  const frames: SseFrame[] = [];
  for await (const frame of parse_sse(chunks_of(parts))) {
    frames.push(frame);
  }
  return frames;
};

test("parse_sse joins frames split across chunks, multi-line data and CRLF line ends", async () => {
  const bytes = new TextEncoder().encode('data: {"text":"über"}\n\n');
  const split = bytes.indexOf(0xc3) + 1;
  const frames = await collect([
    "id: f.1\nev",
    "ent: hello\ndata: {\"boot\":\"f\",",
    "\"api\":1}\n\n: comment line\n",
    "event: ping\r",
    "\n\r\n",
    "id: f.2\nevent: turn.event\ndata: first line\ndata:second line\n\n",
    bytes.slice(0, split),
    bytes.slice(split),
    "event: open",
  ]);
  assert.deepEqual(frames, [
    { id: "f.1", event: "hello", data: '{"boot":"f","api":1}' },
    { id: null, event: "ping", data: "" },
    { id: "f.2", event: "turn.event", data: "first line\nsecond line" },
    { id: null, event: "message", data: '{"text":"über"}' },
  ]);
});

test("to_api_event maps known frames and skips unknown event types", () => {
  assert.deepEqual(to_api_event({ id: "f.1", event: "hello", data: '{"boot":"f","api":1}' }), { type: "hello", id: "f.1", data: { boot: "f", api: 1 } });
  assert.deepEqual(to_api_event({ id: null, event: "ping", data: "" }), { type: "ping", id: null, data: null });
  assert.equal(to_api_event({ id: "f.3", event: "future.thing", data: "{}" }), null);
  assert.equal(to_api_event({ id: null, event: "message", data: "{}" }), null);
});

type Connection = { url: URL; headers: http.IncomingHttpHeaders; response: http.ServerResponse; closed: Promise<void> };

const sse_server = async (on_connect: (connection: Connection, index: number) => void) => {
  const connections: Connection[] = [];
  const server = http.createServer((request, response) => {
    const connection: Connection = {
      url: new URL(request.url ?? "/", "http://127.0.0.1"),
      headers: request.headers,
      response,
      closed: new Promise((resolve) => response.on("close", () => resolve())),
    };
    connections.push(connection);
    on_connect(connection, connections.length - 1);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    config: { base_url: `http://127.0.0.1:${port}`, token: "secret-token" },
    connections,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

const frame = (type: string, data: unknown, id?: string) => `${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const stream_head = (response: http.ServerResponse) => response.writeHead(200, { "content-type": "text/event-stream" });

const turn = (seq: number) => ({ type: "text", round: 1, delta: `d${seq}`, seq, at: 0, chat_id: "chat_1", message_id: "msg_1" });

for (const drop of ["end", "destroy"] as const) {
  test(`events reconnects with the last id after the connection is dropped by ${drop}`, async () => {
    const stub = await sse_server((connection, index) => {
      stream_head(connection.response);
      if (index === 0) {
        connection.response.write(frame("hello", { boot: "f", api: 1 }, "f.0"));
        connection.response.write(frame("turn.event", turn(1), "f.1"));
        connection.response.write(frame("ping", null));
        setTimeout(() => (drop === "end" ? connection.response.end() : connection.response.destroy()), 20);
        return;
      }
      connection.response.write(frame("hello", { boot: "f", api: 1 }, "f.1"));
      connection.response.write(frame("turn.event", turn(2), "f.2"));
    });
    try {
      const seen: ApiEvent[] = [];
      for await (const event of events(stub.config, { session_id: "chat_1" })) {
        seen.push(event);
        if (seen.length === 5) {
          break;
        }
      }
      assert.deepEqual(
        seen.map((event) => [event.type, event.id]),
        [
          ["hello", "f.0"],
          ["turn.event", "f.1"],
          ["ping", null],
          ["hello", "f.1"],
          ["turn.event", "f.2"],
        ],
      );
      assert.equal(stub.connections.length, 2);
      assert.equal(stub.connections[0].url.searchParams.get("session"), "chat_1");
      assert.equal(stub.connections[0].url.searchParams.get("last"), null);
      assert.equal(stub.connections[1].url.searchParams.get("last"), "f.1");
      assert.equal(stub.connections[1].url.searchParams.get("session"), "chat_1");
      assert.equal(stub.connections[1].headers.authorization, "Bearer secret-token");
      await stub.connections[1].closed;
    } finally {
      await stub.close();
    }
  });
}

test("events starts from a given last id and yields resync as it comes", async () => {
  const stub = await sse_server((connection) => {
    stream_head(connection.response);
    connection.response.write(frame("hello", { boot: "g", api: 1 }, "g.0"));
    connection.response.write(frame("resync", null));
  });
  try {
    const seen: ApiEvent["type"][] = [];
    for await (const event of events(stub.config, { last: "f.9" })) {
      seen.push(event.type);
      if (event.type === "resync") {
        break;
      }
    }
    assert.deepEqual(seen, ["hello", "resync"]);
    assert.equal(stub.connections[0].url.searchParams.get("last"), "f.9");
    assert.equal(stub.connections[0].url.searchParams.get("session"), null);
  } finally {
    await stub.close();
  }
});

test("a failed reconnect throws to the consumer with the API error as cause", async () => {
  const stub = await sse_server((connection, index) => {
    if (index === 0) {
      stream_head(connection.response);
      connection.response.write(frame("hello", { boot: "f", api: 1 }, "f.0"));
      setTimeout(() => connection.response.end(), 20);
      return;
    }
    connection.response.writeHead(401, { "content-type": "application/json" });
    connection.response.end(JSON.stringify({ error: { code: "unauthorized", message: "wrong token" } }));
  });
  try {
    const seen: ApiEvent["type"][] = [];
    await assert.rejects(
      async () => {
        for await (const event of events(stub.config)) {
          seen.push(event.type);
        }
      },
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /reconnecting failed: wrong token/);
        assert.ok(error.cause instanceof VantheaxError);
        assert.equal(error.cause.code, "unauthorized");
        return true;
      },
    );
    assert.deepEqual(seen, ["hello"]);
  } finally {
    await stub.close();
  }
});

test("the first connect error is thrown as is", async () => {
  const stub = await sse_server((connection) => {
    connection.response.writeHead(401, { "content-type": "application/json" });
    connection.response.end(JSON.stringify({ error: { code: "unauthorized", message: "wrong token" } }));
  });
  try {
    await assert.rejects(
      async () => {
        for await (const event of events(stub.config)) {
          assert.fail(`unexpected ${event.type}`);
        }
      },
      (error: unknown) => error instanceof VantheaxError && error.status === 401 && error.code === "unauthorized",
    );
  } finally {
    await stub.close();
  }
});

test("aborting the signal stops the stream and closes the request", async () => {
  const stub = await sse_server((connection) => {
    stream_head(connection.response);
    connection.response.write(frame("hello", { boot: "f", api: 1 }, "f.0"));
  });
  try {
    const controller = new AbortController();
    await assert.rejects(
      async () => {
        for await (const event of events(stub.config, { signal: controller.signal })) {
          if (event.type === "hello") {
            controller.abort();
          }
        }
      },
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    await stub.connections[0].closed;
    assert.equal(stub.connections.length, 1);
  } finally {
    await stub.close();
  }
});
