import { classify_provider_error, ModelError, read_provider_error } from "../model/errors.ts";
import { as_record, as_string } from "../model/json.ts";
import { attempt_failure, create_watchdog, send, transport_with, with_retries, type Transport } from "../model/transport.ts";

export const transcription_body = (model: string, audio: Uint8Array): string =>
  JSON.stringify({ model, input_audio: { data: Buffer.from(audio).toString("base64"), format: "webm" } });

export const read_transcript = (text: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn(`[dictation] transcription body is not JSON (${String(error)}): ${text.slice(0, 200)}`);
    throw new ModelError("provider_unavailable", "OpenRouter returned an unreadable transcription.");
  }
  const body = as_record(parsed);
  const provider_error = read_provider_error(body?.error);
  if (provider_error) {
    throw classify_provider_error(null, provider_error, "");
  }
  return as_string(body?.text).trim();
};

const run_attempt = async (body: string, signal: AbortSignal, transport: Transport): Promise<string> => {
  const watchdog = create_watchdog(signal);
  watchdog.arm(transport.first_byte_ms, "complete");
  try {
    const response = await send("POST", "/audio/transcriptions", body, watchdog, transport);
    return read_transcript(await response.text());
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw attempt_failure(error, watchdog, "read");
  } finally {
    watchdog.dispose();
  }
};

export const transcribe = async (model: string, audio: Uint8Array, overrides: Partial<Transport> = {}): Promise<string> => {
  const transport = transport_with(overrides);
  const body = transcription_body(model, audio);
  const signal = new AbortController().signal;
  return with_retries({
    transport,
    signal,
    run: () => run_attempt(body, signal, transport),
    cancelled: () => {
      throw new Error(`transcription with ${model} was cancelled`);
    },
  });
};
