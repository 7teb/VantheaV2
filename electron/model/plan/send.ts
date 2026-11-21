import { promisify } from "node:util";
import { zstdCompress } from "node:zlib";
import { ModelError, parse_retry_after } from "../errors.ts";
import { attempt_failure, type Transport, type Watchdog } from "../transport.ts";
import { plan_error, read_plan_error } from "./errors.ts";
import { plan_source } from "./source.ts";

export const plan_responses_url = "https://api.openai.com/v1/responses";

export const plan_provider = "ChatGPT plan";

export const compress_above_bytes = 512 * 1024;

export type PlanReply = { response: Response; token: string; request_id: string };

type Payload = { body: string | Uint8Array; headers: Record<string, string> };

const compress = promisify(zstdCompress);

const payload = async (body: string): Promise<Payload> => {
  if (Buffer.byteLength(body) <= compress_above_bytes) {
    return { body, headers: {} };
  }
  return { body: new Uint8Array(await compress(Buffer.from(body))), headers: { "Content-Encoding": "zstd" } };
};

const until_aborted = <T>(pending: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });

const wait_token = async (pending: Promise<string>, watchdog: Watchdog): Promise<string> => {
  try {
    return await until_aborted(pending, watchdog.signal);
  } catch (error) {
    throw watchdog.expired() ? attempt_failure(error, watchdog, "connect", plan_provider) : error;
  }
};

const request_id_of = (response: Response): string => response.headers.get("x-request-id") ?? response.headers.get("openai-request-id") ?? "";

const post = async (sent: Payload, token: string, watchdog: Watchdog, transport: Transport): Promise<Response> => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream", ...sent.headers };
  try {
    return await transport.fetch(plan_responses_url, { method: "POST", headers, body: sent.body, signal: watchdog.signal, redirect: "error" });
  } catch (error) {
    throw attempt_failure(error, watchdog, "connect", plan_provider);
  }
};

const failure = async (response: Response, token: string): Promise<ModelError> => {
  let text = "";
  try {
    text = await response.text();
  } catch (error) {
    console.warn(`[plan] POST /v1/responses returned ${response.status} and its error body could not be read: ${String(error)}`);
  }
  return plan_error(response.status, read_plan_error(text), {
    retry_after_ms: parse_retry_after(response.headers.get("retry-after")),
    request_id: request_id_of(response),
    token,
  });
};

const discard = async (response: Response) => {
  try {
    await response.body?.cancel();
  } catch (error) {
    console.warn(`[plan] discarding the body of a ${response.status} answer failed: ${String(error)}`);
  }
};

export const send_plan = async (body: string, watchdog: Watchdog, transport: Transport): Promise<PlanReply> => {
  const source = plan_source();
  const sent = await payload(body);
  let token = await wait_token(source.access_token(), watchdog);
  let response = await post(sent, token, watchdog, transport);
  if (response.status === 401) {
    console.warn(`[plan] POST /v1/responses returned 401 (request ${request_id_of(response) || "without id"}), renewing the access token once`);
    await discard(response);
    token = await wait_token(source.renewed_token(token), watchdog);
    response = await post(sent, token, watchdog, transport);
  }
  if (!response.ok) {
    throw await failure(response, token);
  }
  return { response, token, request_id: request_id_of(response) };
};
