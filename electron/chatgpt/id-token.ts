import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";
import { error_text, is_record } from "../storage/coerce.ts";
import { issuer, jwks_uri } from "./endpoints.ts";
import type { Fetch } from "./token-endpoint.ts";

export type IdClaims = { sub: string; email: string | null; name: string | null };

type IdExpectation = { client_id: string; nonce: string | null; now: number };

export type KeySet = { key: (kid: string) => Promise<KeyObject | null> };

export class SigningKeysUnavailable extends Error {}

const clock_tolerance_s = 5;

const load_keys = async (fetch: Fetch): Promise<Map<string, KeyObject>> => {
  let body: unknown;
  try {
    const response = await fetch(jwks_uri, { method: "GET", headers: { Accept: "application/json" }, redirect: "error" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    body = await response.json();
  } catch (error) {
    throw new SigningKeysUnavailable(`fetching the OpenAI signing keys failed: ${error_text(error)}`, { cause: error });
  }
  const keys = new Map<string, KeyObject>();
  const entries = is_record(body) && Array.isArray(body.keys) ? body.keys : [];
  for (const entry of entries) {
    if (!is_record(entry) || typeof entry.kid !== "string" || entry.kty !== "RSA") {
      continue;
    }
    if ((entry.use !== undefined && entry.use !== "sig") || (entry.alg !== undefined && entry.alg !== "RS256")) {
      continue;
    }
    try {
      keys.set(entry.kid, createPublicKey({ key: entry as JsonWebKey, format: "jwk" }));
    } catch (error) {
      console.error(`[chatgpt] the OpenAI signing key ${entry.kid} could not be read:`, error_text(error));
    }
  }
  return keys;
};

export const create_key_set = (fetch: Fetch): KeySet => {
  let cached: Map<string, KeyObject> | null = null;
  return {
    key: async (kid) => {
      const known = cached?.get(kid);
      if (known) {
        return known;
      }
      cached = await load_keys(fetch);
      return cached.get(kid) ?? null;
    },
  };
};

const decode_part = (part: string, label: string): Record<string, unknown> => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch (error) {
    throw new Error(`the ID token ${label} is not valid JSON: ${error_text(error)}`, { cause: error });
  }
  if (!is_record(value)) {
    throw new Error(`the ID token ${label} is not a JSON object`);
  }
  return value;
};

const audience_matches = (aud: unknown, client_id: string): boolean =>
  aud === client_id || (Array.isArray(aud) && aud.includes(client_id));

export const verify_id_token = async (token: string, expected: IdExpectation, keys: KeySet): Promise<IdClaims> => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("the ID token is not a signed JWT");
  }
  const [header_part = "", payload_part = "", signature_part = ""] = parts;
  const header = decode_part(header_part, "header");
  if (header.alg !== "RS256") {
    throw new Error("the ID token is not signed with RS256");
  }
  if (typeof header.kid !== "string") {
    throw new Error("the ID token names no signing key");
  }
  const key = await keys.key(header.kid);
  if (!key) {
    throw new Error(`the ID token was signed with the unknown key ${header.kid}`);
  }
  const signed = Buffer.from(`${header_part}.${payload_part}`);
  if (!verify("sha256", signed, key, Buffer.from(signature_part, "base64url"))) {
    throw new Error("the ID token signature is invalid");
  }
  const claims = decode_part(payload_part, "payload");
  const now_s = expected.now / 1000;
  if (claims.iss !== issuer) {
    throw new Error("the ID token has the wrong issuer");
  }
  if (!audience_matches(claims.aud, expected.client_id)) {
    throw new Error("the ID token was issued for another client");
  }
  if (typeof claims.exp !== "number" || now_s >= claims.exp + clock_tolerance_s) {
    throw new Error("the ID token has expired");
  }
  if (typeof claims.iat !== "number") {
    throw new Error("the ID token has no issue time");
  }
  if (typeof claims.sub !== "string" || claims.sub === "") {
    throw new Error("the ID token names no subject");
  }
  if (expected.nonce !== null && claims.nonce !== expected.nonce) {
    throw new Error("the ID token belongs to another sign-in attempt");
  }
  if (claims.azp !== undefined && claims.azp !== expected.client_id) {
    throw new Error("the ID token was authorized for another client");
  }
  return {
    sub: claims.sub,
    email: typeof claims.email === "string" && claims.email !== "" ? claims.email : null,
    name: typeof claims.name === "string" && claims.name !== "" ? claims.name : null,
  };
};
