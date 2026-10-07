import { error_text } from "../../storage/coerce.ts";
import { attempt_failure, create_watchdog, send, transport_with, with_retries, type Transport } from "../../model/transport.ts";
import { accepts_image_input, parse_image_response, type DecodedImage, type ImageRequest } from "./request.ts";

const image_transport: Partial<Transport> = { max_attempts: 2, first_byte_ms: 600000 };

const discovery_timeout_ms = 15000;

let image_models: Promise<unknown> | null = null;

export const request_images = (body: ImageRequest, signal: AbortSignal, overrides: Partial<Transport> = {}): Promise<DecodedImage[]> => {
  const transport = transport_with({ ...image_transport, ...overrides });
  const payload = JSON.stringify(body);
  return with_retries({
    transport,
    signal,
    run: async () => {
      const watchdog = create_watchdog(signal);
      watchdog.arm(transport.first_byte_ms, "first_byte");
      try {
        const response = await send("POST", "/images", payload, watchdog, transport);
        watchdog.arm(transport.idle_ms, "idle");
        return parse_image_response(await response.text());
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        throw attempt_failure(error, watchdog, "read");
      } finally {
        watchdog.dispose();
      }
    },
    cancelled: () => {
      throw signal.reason ?? new Error(`image generation with ${body.model} was cancelled`);
    },
  });
};

const load_image_models = async (transport: Transport): Promise<unknown> => {
  const watchdog = create_watchdog(AbortSignal.timeout(discovery_timeout_ms));
  watchdog.arm(discovery_timeout_ms, "first_byte");
  try {
    const response = await send("GET", "/images/models", null, watchdog, transport);
    return JSON.parse(await response.text());
  } catch (error) {
    throw attempt_failure(error, watchdog, "read");
  } finally {
    watchdog.dispose();
  }
};

export const image_input_support = async (model_id: string, overrides: Partial<Transport> = {}): Promise<boolean | null> => {
  image_models ??= load_image_models(transport_with(overrides));
  try {
    return accepts_image_input(await image_models, model_id);
  } catch (error) {
    image_models = null;
    console.warn(`[image] reading the image model list failed, sending the edit without a capability check: ${error_text(error)}`);
    return null;
  }
};
