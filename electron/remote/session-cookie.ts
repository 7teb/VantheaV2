import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const cookie_name = "vx_session";

export const session_max_age = 34_560_000;

const session_pattern = /^[A-Za-z0-9_-]{16,64}$/;

const signature_of = (token: string, session_id: string) => createHmac("sha256", token).update(`vx-session:${session_id}`).digest("base64url");

export const token_matches = (token: string, candidate: string): boolean => {
  const expected = Buffer.from(token);
  const given = Buffer.from(candidate);
  return expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
};

export const sign_session = (token: string, session_id: string): string => `${session_id}.${signature_of(token, session_id)}`;

const cookie_values = (header: string, name: string): string[] =>
  header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));

export const verify_session = (token: string, cookie_header: string): string | null => {
  if (!token) {
    return null;
  }
  for (const value of cookie_values(cookie_header, cookie_name)) {
    const dot = value.lastIndexOf(".");
    const session_id = value.slice(0, dot);
    if (dot <= 0 || !session_pattern.test(session_id)) {
      continue;
    }
    if (token_matches(signature_of(token, session_id), value.slice(dot + 1))) {
      return session_id;
    }
  }
  return null;
};

export const session_cookie = (token: string, session_id: string): string =>
  `${cookie_name}=${sign_session(token, session_id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${session_max_age}`;

export const new_token = (): string => randomBytes(32).toString("base64url");

export const new_session_id = (): string => randomBytes(16).toString("base64url");
