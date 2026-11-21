import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { callback_page } from "../electron/chatgpt/callback-page.ts";
import { start_callback_server } from "../electron/chatgpt/callback-server.ts";

const page = (received: boolean) => (received ? "received" : "failed");

const get = async (url: string, method = "GET") => {
  const response = await fetch(url, { method });
  return { status: response.status, text: await response.text(), headers: response.headers };
};

const connects = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

test("the listener binds to 127.0.0.1 on an ephemeral port and answers only GET /auth/callback", async () => {
  const server = await start_callback_server("expected", page);
  const url = new URL(server.redirect_uri);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/auth/callback");
  const port = Number(url.port);
  assert.ok(port > 0);
  assert.equal(await connects("127.0.0.1", port), true);
  assert.equal(await connects("::1", port), false);
  for (const target of [`${url.origin}/`, `${url.origin}/callback`, `${url.origin}/auth/callback/extra`, `${url.origin}/favicon.ico?state=expected`]) {
    assert.equal((await get(target)).status, 404, target);
  }
  assert.equal((await get(`${server.redirect_uri}?state=expected&code=c`, "POST")).status, 404);
  server.close();
  assert.equal(await server.result, null);
});

test("a wrong state gets 400 and the listener keeps waiting for the right one", async () => {
  const server = await start_callback_server("expected", page);
  const wrong = await get(`${server.redirect_uri}?state=other&code=c1`);
  assert.equal(wrong.status, 400);
  const missing = await get(`${server.redirect_uri}?code=c1`);
  assert.equal(missing.status, 400);
  const right = await get(`${server.redirect_uri}?state=expected&code=c2&client_id=oaiapp_1`);
  assert.equal(right.status, 200);
  assert.equal(right.text, "received");
  assert.match(right.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(right.headers.get("content-security-policy"), "default-src 'none'");
  const params = await server.result;
  assert.equal(params?.get("code"), "c2");
  assert.equal(params?.get("client_id"), "oaiapp_1");
});

const raw_request = (port: number, target: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      received += chunk;
    });
    socket.once("error", reject);
    socket.once("end", () => resolve(received));
    socket.once("connect", () => socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
  });

test("an unparsable request target gets 400 and the listener keeps waiting for the right state", async () => {
  const server = await start_callback_server("expected", page);
  const port = Number(new URL(server.redirect_uri).port);
  for (const target of ["//[", "http://[/auth/callback"]) {
    assert.match(await raw_request(port, target), /^HTTP\/1\.1 400 /, target);
  }
  const right = await get(`${server.redirect_uri}?state=expected&code=c3`);
  assert.equal(right.status, 200);
  assert.equal((await server.result)?.get("code"), "c3");
});

test("the listener closes after the valid callback and shows the failure page for an error callback", async () => {
  const server = await start_callback_server("expected", page);
  const port = Number(new URL(server.redirect_uri).port);
  const answer = await get(`${server.redirect_uri}?state=expected&error=access_denied`);
  assert.equal(answer.status, 200);
  assert.equal(answer.text, "failed");
  assert.equal((await server.result)?.get("error"), "access_denied");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await connects("127.0.0.1", port), false);
});

test("closing the listener ends the attempt without a result", async () => {
  const server = await start_callback_server("expected", page);
  const port = Number(new URL(server.redirect_uri).port);
  server.close();
  assert.equal(await server.result, null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await connects("127.0.0.1", port), false);
});

test("the callback page is static HTML without script, colour or external resources in both languages", () => {
  const pages = [callback_page("en", true), callback_page("en", false), callback_page("de", true), callback_page("de", false)];
  assert.ok(pages[0]?.includes("Sign-in received. Return to VantheaX."));
  assert.ok(pages[1]?.includes("Sign-in was not completed. Return to VantheaX."));
  assert.ok(pages[2]?.includes("Anmeldung empfangen. Kehre zu VantheaX zurück."));
  assert.ok(pages[3]?.includes("Die Anmeldung wurde nicht abgeschlossen. Kehre zu VantheaX zurück."));
  assert.ok(pages[2]?.includes('lang="de"'));
  for (const html of pages) {
    assert.ok(html.startsWith("<!doctype html>"));
    assert.doesNotMatch(html, /<script|<style|<link|<img|style=|color|https?:/i);
  }
});
