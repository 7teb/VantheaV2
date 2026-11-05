import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { ImageModelEntry } from "../shared/models.ts";
import { ModelError } from "../electron/model/errors.ts";
import { set_key_source } from "../electron/model/key.ts";
import type { Transport } from "../electron/model/transport.ts";
import { image_input_support, request_images } from "../electron/tools/image/openrouter.ts";
import { accepts_image_input, image_body, parse_image_response } from "../electron/tools/image/request.ts";

type Call = { url: string; init: RequestInit };

const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

const gpt: ImageModelEntry = { id: "openai/gpt-image-2", label: "GPT Image 2", quality: true };

const gemini: ImageModelEntry = { id: "google/gemini-3.1-flash-image", label: "Nano Banana 2", quality: false };

const fake = (responses: Response[]) => {
  const calls: Call[] = [];
  const overrides: Partial<Transport> = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) {
        throw new Error(`unexpected request to ${url}`);
      }
      return next;
    },
    sleep: async () => undefined,
    random: () => 0,
  };
  return { calls, overrides };
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

before(() => {
  set_key_source(() => "sk-or-v1-test");
});

test("image_body sends quality only for models with a quality knob and never auto", () => {
  assert.deepEqual(image_body({ model: gpt, prompt: "a fox", quality: "high", references: [] }), {
    model: "openai/gpt-image-2",
    prompt: "a fox",
    n: 1,
    quality: "high",
  });
  assert.deepEqual(image_body({ model: gpt, prompt: "a fox", quality: "auto", references: [] }), { model: "openai/gpt-image-2", prompt: "a fox", n: 1 });
  assert.deepEqual(image_body({ model: gemini, prompt: "a fox", quality: "high", references: [] }), {
    model: "google/gemini-3.1-flash-image",
    prompt: "a fox",
    n: 1,
  });
});

test("image_body passes edit sources as input_references image_url parts", () => {
  const body = image_body({ model: gemini, prompt: "make it blue", quality: "auto", references: ["data:image/png;base64,AAAA"] });
  assert.deepEqual(body.input_references, [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }]);
});

test("parse_image_response decodes data[].b64_json with media_type", () => {
  const images = parse_image_response(
    JSON.stringify({ created: 1748372400, data: [{ b64_json: png.toString("base64"), media_type: "image/png" }, { b64_json: "" }], usage: { cost: 0.04 } }),
  );
  assert.equal(images.length, 1);
  assert.equal(images[0]?.mime, "image/png");
  assert.deepEqual(images[0]?.bytes, png);
  assert.equal(parse_image_response(JSON.stringify({ created: 1, data: [{ b64_json: png.toString("base64") }] }))[0]?.mime, "image/png");
  assert.deepEqual(parse_image_response(JSON.stringify({ created: 1, data: [] })), []);
});

test("parse_image_response rejects unreadable bodies and in-body errors without retrying", () => {
  assert.throws(() => parse_image_response("<html>"), (error: unknown) => error instanceof ModelError && error.kind === "internal");
  assert.throws(
    () => parse_image_response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } })),
    (error: unknown) => error instanceof ModelError && error.kind === "credits",
  );
});

test("request_images posts the body to /api/v1/images with the OpenRouter key", async () => {
  const { calls, overrides } = fake([json(200, { created: 1, data: [{ b64_json: png.toString("base64"), media_type: "image/png" }] })]);
  const body = image_body({ model: gpt, prompt: "a lighthouse", quality: "low", references: [] });
  const images = await request_images(body, new AbortController().signal, overrides);
  assert.equal(images.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://openrouter.ai/api/v1/images");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, "Bearer sk-or-v1-test");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model: "openai/gpt-image-2", prompt: "a lighthouse", n: 1, quality: "low" });
});

test("request_images surfaces a provider 400 as a non-retried bad_request", async () => {
  const { calls, overrides } = fake([json(400, { error: { code: 400, message: "Invalid request parameters" } })]);
  await assert.rejects(
    request_images(image_body({ model: gpt, prompt: "x", quality: "auto", references: [] }), new AbortController().signal, overrides),
    (error: unknown) => error instanceof ModelError && error.kind === "bad_request" && /Invalid request parameters/.test(error.message),
  );
  assert.equal(calls.length, 1);
});

test("request_images retries a 503 once and then succeeds", async () => {
  const { calls, overrides } = fake([
    json(503, { error: { code: 503, message: "overloaded" } }),
    json(200, { created: 1, data: [{ b64_json: png.toString("base64") }] }),
  ]);
  const images = await request_images(image_body({ model: gpt, prompt: "x", quality: "auto", references: [] }), new AbortController().signal, overrides);
  assert.equal(images.length, 1);
  assert.equal(calls.length, 2);
});

test("request_images stops when the turn is aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("turn stopped"));
  const { calls, overrides } = fake([]);
  await assert.rejects(request_images(image_body({ model: gpt, prompt: "x", quality: "auto", references: [] }), controller.signal, overrides), /turn stopped/);
  assert.equal(calls.length, 0);
});

test("accepts_image_input reads architecture.input_modalities from the image model list", () => {
  const listing = {
    data: [
      { id: "a/text-only", architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
      { id: "b/editor", architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] } },
    ],
  };
  assert.equal(accepts_image_input(listing, "a/text-only"), false);
  assert.equal(accepts_image_input(listing, "b/editor"), true);
  assert.equal(accepts_image_input(listing, "c/unknown"), null);
});

test("image_input_support queries GET /api/v1/images/models once and caches it", async () => {
  const listing = { data: [{ id: "b/editor", architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] } }] };
  const { calls, overrides } = fake([json(200, listing)]);
  assert.equal(await image_input_support("b/editor", overrides), true);
  assert.equal(await image_input_support("x/missing", overrides), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://openrouter.ai/api/v1/images/models");
  assert.equal(calls[0]?.init.method, "GET");
});
