import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { ApiErrorCode } from "../../shared/api/contract.ts";

type Refusal = { status: number; code: ApiErrorCode; message: string };

const bearer = /^Bearer[ \t]+(\S+)[ \t]*$/i;

const digest = (text: string) => createHash("sha256").update(text).digest();

export const check_request = (headers: IncomingHttpHeaders, expected: { token: string; port: number }): Refusal | null => {
  const host = (headers.host ?? "").toLowerCase();
  if (host !== `127.0.0.1:${expected.port}` && host !== `localhost:${expected.port}`) {
    return { status: 421, code: "bad_host", message: `the Host header must be 127.0.0.1:${expected.port} or localhost:${expected.port}` };
  }
  if (headers.origin !== undefined) {
    return { status: 403, code: "forbidden_origin", message: "requests that carry an Origin header are refused" };
  }
  const given = bearer.exec(headers.authorization ?? "")?.[1] ?? "";
  if (!timingSafeEqual(digest(given), digest(expected.token))) {
    return { status: 401, code: "unauthorized", message: "the Authorization header must be Bearer <VANTHEAX_API_TOKEN>" };
  }
  return null;
};
