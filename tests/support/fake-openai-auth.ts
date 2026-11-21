import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatgptAccount, ChatgptSignIn } from "../../shared/chatgpt.ts";
import { init_chatgpt, start_sign_in, type ChatgptDeps } from "../../electron/chatgpt/service.ts";
import { api_resource, authorize_endpoint, issuer, jwks_uri, models_endpoint, registration_client_id, revocation_endpoint, scope, token_endpoint } from "../../electron/chatgpt/endpoints.ts";

export type Recorded = { url: string; method: string; headers: Record<string, string>; body: string; redirect: string | undefined; form: URLSearchParams };

export type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

export type SigningKey = { kid: string; private_key: KeyObject; jwk: Record<string, unknown> };

type Grant = { client_id: string; redirect_uri: string; challenge: string; nonce: string; used: boolean };

export const make_key = (kid: string): SigningKey => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, private_key: privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export const sign_jwt = (key: SigningKey, claims: Record<string, unknown>, header: Record<string, unknown> = {}): string => {
  const head = encode({ alg: "RS256", typ: "JWT", kid: key.kid, ...header });
  const body = encode(claims);
  const signature = sign("sha256", Buffer.from(`${head}.${body}`), key.private_key).toString("base64url");
  return `${head}.${body}.${signature}`;
};

const reply = (answer: Reply): Response => {
  const body = answer.body === undefined ? "" : typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
  return new Response(body, { status: answer.status, headers: answer.headers ?? (typeof answer.body === "object" ? { "Content-Type": "application/json" } : {}) });
};

const header_record = (headers: RequestInit["headers"]): Record<string, string> => {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    result[name] = value;
  });
  return result;
};

export const oauth_error = (code: string, status = 400): Reply => ({ status, body: { error: code, error_description: `fake ${code}` } });

export const fake_openai = (now: () => number) => {
  const requests: Recorded[] = [];
  const authorize_urls: URL[] = [];
  const codes = new Map<string, Grant>();
  const used_refresh = new Set<string>();
  let serial = 0;
  const fake = {
    requests,
    authorize_urls,
    account: { sub: "user-ada", email: "ada@example.com" as string | null, name: "Ada" as string | null },
    issued_client_id: "oaiapp_fake_1",
    granted_scope: scope,
    expires_in: 3600,
    earliest_refresh_at: undefined as unknown,
    refresh_scope: null as string | null,
    refresh_id_token: null as Record<string, unknown> | null,
    token_replies: [] as (Reply | "network")[],
    revoke_replies: [] as (Reply | "network")[],
    jwks_replies: [] as (Reply | "network")[],
    models_replies: [] as Reply[],
    models: [] as unknown[],
    issued: [] as string[],
    valid_access: new Set<string>(),
    valid_refresh: new Map<string, string>(),
    gate: null as Promise<void> | null,
    revoke_gate: null as Promise<void> | null,
    signer: make_key("key-1"),
    jwks_keys: [] as SigningKey[],
    count: (url: string) => requests.filter((entry) => entry.url === url).length,
    forms: (url: string) => requests.filter((entry) => entry.url === url).map((entry) => entry.form),
    id_token: (claims: Record<string, unknown>, header: Record<string, unknown> = {}) => sign_jwt(fake.signer, claims, header),
    claims: (client_id: string, nonce: string | null): Record<string, unknown> => {
      const now_s = Math.floor(now() / 1000);
      const claims: Record<string, unknown> = { iss: issuer, aud: [client_id], sub: fake.account.sub, iat: now_s, exp: now_s + 3600 };
      if (fake.account.email !== null) {
        claims.email = fake.account.email;
      }
      if (fake.account.name !== null) {
        claims.name = fake.account.name;
      }
      if (nonce !== null) {
        claims.nonce = nonce;
      }
      return claims;
    },
    authorize: (address: string, overrides: Record<string, string | null> = {}): string => {
      const url = new URL(address);
      authorize_urls.push(url);
      if (`${url.origin}${url.pathname}` !== authorize_endpoint) {
        throw new Error(`the fake authorize endpoint got ${url.origin}${url.pathname}`);
      }
      const params = url.searchParams;
      const requested = params.get("client_id") ?? "";
      const client_id = requested === registration_client_id ? fake.issued_client_id : requested;
      const redirect_uri = params.get("redirect_uri") ?? "";
      serial += 1;
      const code = `code-${serial}`;
      codes.set(code, { client_id, redirect_uri, challenge: params.get("code_challenge") ?? "", nonce: params.get("nonce") ?? "", used: false });
      const callback = new URL(redirect_uri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", params.get("state") ?? "");
      callback.searchParams.set("scope", fake.granted_scope);
      if (requested === registration_client_id) {
        callback.searchParams.set("client_id", client_id);
      }
      for (const [name, value] of Object.entries(overrides)) {
        if (value === null) {
          callback.searchParams.delete(name);
        } else {
          callback.searchParams.set(name, value);
        }
      }
      return callback.toString();
    },
    fetch: async (url: string, init: RequestInit): Promise<Response> => {
      const body = typeof init.body === "string" ? init.body : "";
      const form = new URLSearchParams(body);
      requests.push({ url, method: init.method ?? "GET", headers: header_record(init.headers), body, redirect: init.redirect, form });
      if (url === token_endpoint) {
        if (fake.gate) {
          await fake.gate;
        }
        const queued = fake.token_replies.shift();
        if (queued === "network") {
          throw new TypeError("fetch failed");
        }
        return reply(queued ?? token_answer(form));
      }
      if (url === revocation_endpoint) {
        if (fake.revoke_gate) {
          await fake.revoke_gate;
        }
        const queued = fake.revoke_replies.shift();
        if (queued === "network") {
          throw new TypeError("fetch failed");
        }
        fake.valid_refresh.delete(form.get("token") ?? "");
        return reply(queued ?? { status: 200 });
      }
      if (url === jwks_uri) {
        const queued = fake.jwks_replies.shift();
        if (queued === "network") {
          throw new TypeError("fetch failed");
        }
        return reply(queued ?? { status: 200, body: { keys: fake.jwks_keys.map((key) => key.jwk) } });
      }
      if (url === models_endpoint) {
        const bearer = (header_record(init.headers).authorization ?? "").replace(/^Bearer /, "");
        if (!fake.valid_access.has(bearer)) {
          return reply({ status: 401, body: { error: "invalid_token", error_description: "fake" } });
        }
        return reply(fake.models_replies.shift() ?? { status: 200, body: { models: fake.models } });
      }
      throw new Error(`the fake OpenAI got an unexpected request to ${url}`);
    },
  };
  fake.jwks_keys.push(fake.signer);
  const issue = (client_id: string, nonce: string | null) => {
    serial += 1;
    const access_token = `at-${serial}-secret`;
    const refresh_token = `rt-${serial}-secret`;
    fake.valid_access.add(access_token);
    fake.valid_refresh.set(refresh_token, client_id);
    fake.issued.push(access_token, refresh_token);
    const answer: Record<string, unknown> = { access_token, refresh_token, token_type: "Bearer", expires_in: fake.expires_in };
    if (fake.earliest_refresh_at !== undefined) {
      answer.earliest_refresh_at = fake.earliest_refresh_at;
    }
    if (nonce !== null) {
      answer.id_token = fake.id_token(fake.claims(client_id, nonce));
      answer.scope = fake.granted_scope;
      fake.issued.push(String(answer.id_token));
    }
    return answer;
  };
  const token_answer = (form: URLSearchParams): Reply => {
    if (form.has("client_secret") || form.get("resource") !== api_resource) {
      return oauth_error("invalid_request");
    }
    const client_id = form.get("client_id") ?? "";
    if (form.get("grant_type") === "authorization_code") {
      const grant = codes.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!grant || grant.used || grant.client_id !== client_id || grant.redirect_uri !== form.get("redirect_uri") || grant.challenge !== challenge) {
        return oauth_error("invalid_grant");
      }
      grant.used = true;
      return { status: 200, body: issue(client_id, grant.nonce) };
    }
    if (form.get("grant_type") === "refresh_token") {
      const refresh_token = form.get("refresh_token") ?? "";
      if (used_refresh.has(refresh_token)) {
        return oauth_error("refresh_token_reused");
      }
      if (fake.valid_refresh.get(refresh_token) !== client_id || form.has("scope")) {
        return oauth_error("invalid_grant");
      }
      fake.valid_refresh.delete(refresh_token);
      used_refresh.add(refresh_token);
      const answer = issue(client_id, null);
      if (fake.refresh_scope !== null) {
        answer.scope = fake.refresh_scope;
      }
      if (fake.refresh_id_token) {
        answer.id_token = fake.id_token(fake.refresh_id_token);
        fake.issued.push(String(answer.id_token));
      }
      return { status: 200, body: answer };
    }
    return oauth_error("unsupported_grant_type");
  };
  return fake;
};

export type FakeOpenai = ReturnType<typeof fake_openai>;

export const temp_root = () => fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-chatgpt-"));

export const account_kit = (root: string, name: string, options: { available?: boolean; start?: number } = {}) => {
  let clock = options.start ?? 1_800_000_000_000;
  const fake = fake_openai(() => clock);
  const vault = { stored: "", writes: [] as string[], available: options.available ?? true };
  const changes: ChatgptAccount[] = [];
  const waiters: { from: number; test: (account: ChatgptAccount) => boolean; resolve: (account: ChatgptAccount) => void }[] = [];
  const model_waiters: { count: number; resolve: () => void }[] = [];
  const pages: Promise<{ status: number; text: string }>[] = [];
  const sleeps: number[] = [];
  const kit = {
    fake,
    vault,
    changes,
    pages,
    sleeps,
    models_changed: 0,
    callback: {} as Record<string, string | null>,
    opened: [] as string[],
    open_failure: null as ((url: string) => Error) | null,
    browse: true,
    advance: (ms: number) => {
      clock += ms;
    },
    stored: () => (vault.stored === "" ? null : JSON.parse(vault.stored)),
    wait_for: (test: (account: ChatgptAccount) => boolean, from: number): Promise<ChatgptAccount> => {
      const seen = changes.slice(from).find(test);
      if (seen) {
        return Promise.resolve(seen);
      }
      return new Promise((resolve) => waiters.push({ from, test, resolve }));
    },
    wait_models: (count: number): Promise<void> =>
      kit.models_changed >= count ? Promise.resolve() : new Promise((resolve) => model_waiters.push({ count, resolve })),
  };
  const deps: ChatgptDeps = {
    fetch: fake.fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    open_url: async (url) => {
      kit.opened.push(url);
      if (kit.open_failure) {
        throw kit.open_failure(url);
      }
      if (kit.browse) {
        const target = fake.authorize(url, kit.callback);
        pages.push(fetch(target).then(async (response) => ({ status: response.status, text: await response.text() })));
      }
    },
    secret: {
      available: () => vault.available,
      read: () => vault.stored,
      write: async (plain) => {
        vault.stored = plain;
        vault.writes.push(plain);
      },
    },
    file: path.join(root, name, "chatgpt.json"),
    language: () => "en",
    changed: (account) => {
      changes.push(account);
      for (const waiter of [...waiters]) {
        if (changes.length > waiter.from && waiter.test(account)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(account);
        }
      }
    },
    models_changed: () => {
      kit.models_changed += 1;
      for (const waiter of model_waiters.filter((entry) => kit.models_changed >= entry.count)) {
        model_waiters.splice(model_waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    },
  };
  return Object.assign(kit, { deps });
};

export type AccountKit = ReturnType<typeof account_kit>;

export const settled = (account: ChatgptAccount) => account.status !== "signing_in";

export const sign_in_with = async (kit: AccountKit, request: ChatgptSignIn = { fresh: false, consent: false }): Promise<ChatgptAccount> => {
  const mark = kit.changes.length;
  const models = kit.models_changed;
  await start_sign_in(request);
  const account = await kit.wait_for(settled, mark);
  await Promise.all(kit.pages);
  if (account.status === "signed_in" && account.error === null) {
    await kit.wait_models(models + 1);
  }
  return account;
};

export const signed_in_kit = async (root: string, name: string): Promise<AccountKit> => {
  const kit = account_kit(root, name);
  await init_chatgpt(kit.deps);
  const account = await sign_in_with(kit);
  if (account.status !== "signed_in") {
    throw new Error(`the test sign-in ended as ${account.status} (${account.error?.code ?? "no error"})`);
  }
  return kit;
};

export const token_values = (kit: AccountKit): string[] => {
  const codes = kit.fake.forms(token_endpoint).map((form) => form.get("code") ?? "");
  return [...new Set([...kit.fake.issued, ...codes])].filter((value) => value !== "");
};
