import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import { fit_images, image_left_out_text, shrink_images, type ImageShrinker } from "../electron/context/images.ts";
import { screenshot_stub, trim_tool_messages, trimmed_stub } from "../electron/context/trim.ts";
import type { ImageLimit } from "../electron/model/image-limits.ts";
import type { ApiAssistantMessage, ApiContentPart, ApiMessage, ApiUserMessage } from "../electron/model/types.ts";
import { carrier } from "../electron/turn/carriers.ts";

const none: ImageLimit = { max_images: null, max_request_bytes: null, max_encoded_bytes: null, max_decoded_bytes: null, edges: [] };

const png_url = (width: number, height: number, extra = 0) => {
  const head = Buffer.alloc(24 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return `data:image/png;base64,${head.toString("base64")}`;
};

const shot = (name: string, url = png_url(100, 100)) => carrier([{ label: `[Screenshot ${name}]`, url }]);

const attachment = (url: string): ApiUserMessage => ({ role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url } }] });

const call = (id: string) => ({ id, type: "function" as const, function: { name: "browser_screenshot", arguments: "{}" } });

const reasoned = (id: string): ApiAssistantMessage => ({ role: "assistant", content: null, tool_calls: [call(id)], reasoning_details: [{ type: "reasoning.text", text: id }] });

const parts = (message: ApiMessage | undefined): ApiContentPart[] => (message?.role === "user" && Array.isArray(message.content) ? message.content : []);

const left_out = (message: ApiMessage | undefined) => parts(message).filter((part) => part.type === "text" && part.text === image_left_out_text).length;

const images = (messages: ApiMessage[]) => messages.flatMap(parts).filter((part) => part.type === "image_url").length;

const body = (messages: ApiMessage[]) => () => Buffer.byteLength(JSON.stringify({ messages }));

test("too many images: the oldest carrier images go first, attachments last", () => {
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, attachment(png_url(10, 10)), shot("a"), shot("b"), shot("c")];
  assert.equal(fit_images(messages, { ...none, max_images: 2 }, body(messages), false), true);
  assert.deepEqual([left_out(messages[1]), left_out(messages[2]), left_out(messages[3]), left_out(messages[4])], [0, 1, 1, 0]);
  assert.equal(images(messages), 2);
  assert.deepEqual(parts(messages[2])[0], { type: "text", text: "[Screenshot a]" });
});

test("attachments are replaced only when no carrier image is left", () => {
  const messages: ApiMessage[] = [attachment(png_url(10, 10)), attachment(png_url(11, 11)), shot("a")];
  fit_images(messages, { ...none, max_images: 1 }, body(messages), false);
  assert.deepEqual([left_out(messages[0]), left_out(messages[1]), left_out(messages[2])], [1, 0, 1]);
});

test("the request byte limit replaces images until the measured body fits", () => {
  const messages: ApiMessage[] = [shot("a", png_url(10, 10, 3000)), shot("b", png_url(10, 10, 3000)), shot("c", png_url(10, 10, 3000))];
  const limit = { ...none, max_request_bytes: body(messages)() - 5000 };
  assert.equal(fit_images(messages, limit, body(messages), false), true);
  assert.deepEqual(messages.map(left_out), [1, 1, 0]);
  assert.ok(body(messages)() <= limit.max_request_bytes);
});

test("per-image byte limits check the encoded or the decoded size", () => {
  const small = png_url(10, 10);
  const large = png_url(10, 10, 4000);
  const encoded: ApiMessage[] = [shot("a", large), shot("b", small)];
  fit_images(encoded, { ...none, max_encoded_bytes: 2000 }, body(encoded), false);
  assert.deepEqual(encoded.map(left_out), [1, 0]);
  const decoded: ApiMessage[] = [shot("a", large), shot("b", small)];
  fit_images(decoded, { ...none, max_decoded_bytes: 3000 }, body(decoded), false);
  assert.deepEqual(decoded.map(left_out), [1, 0]);
});

test("the many-image edge rule applies only from its image count on", () => {
  const limit: ImageLimit = { ...none, edges: [{ min_images: 3, max_edge: 2000 }] };
  const two: ApiMessage[] = [shot("a", png_url(2500, 100)), shot("b")];
  assert.equal(fit_images(two, limit, body(two), false), false);
  const three: ApiMessage[] = [shot("a"), shot("b", png_url(2500, 100)), shot("c")];
  assert.equal(fit_images(three, limit, body(three), false), true);
  assert.deepEqual(three.map(left_out), [0, 1, 0]);
});

test("a second call on the fitted messages changes nothing", () => {
  const messages: ApiMessage[] = [shot("a"), shot("b"), shot("c")];
  assert.equal(fit_images(messages, { ...none, max_images: 1 }, body(messages), false), true);
  const before = JSON.stringify(messages);
  assert.equal(fit_images(messages, { ...none, max_images: 1 }, body(messages), false), false);
  assert.equal(JSON.stringify(messages), before);
});

test("reasoning after the first replaced image is dropped only for prefix-bound models", () => {
  const build = (): ApiMessage[] => [{ role: "user", content: "go" }, reasoned("a"), { role: "tool", tool_call_id: "a", content: "x" }, shot("a"), reasoned("b"), { role: "tool", tool_call_id: "b", content: "x" }, shot("b"), reasoned("c")];
  const bound = build();
  fit_images(bound, { ...none, max_images: 1 }, body(bound), true);
  const kept = bound.filter((message): message is ApiAssistantMessage => message.role === "assistant").map((message) => Boolean(message.reasoning_details));
  assert.deepEqual(kept, [true, false, false]);
  const free = build();
  fit_images(free, { ...none, max_images: 1 }, body(free), false);
  assert.deepEqual(free.filter((message): message is ApiAssistantMessage => message.role === "assistant").map((message) => Boolean(message.reasoning_details)), [true, true, true]);
});

test("no documented rule leaves every image alone", () => {
  const messages: ApiMessage[] = [shot("a", png_url(9000, 9000)), shot("b")];
  assert.equal(fit_images(messages, none, () => Number.MAX_SAFE_INTEGER, true), false);
  assert.equal(images(messages), 2);
});

const trim_model = (id: string): ModelEntry => ({
  id,
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: true,
  context_length: 3000,
  max_output: 1000,
  reasoning_passback: false,
});

test("the context trim replaces tool texts and carrier images in message order and drops later reasoning for Claude", () => {
  const long = "x".repeat(4000);
  const build = (): ApiMessage[] => [
    { role: "user", content: "go" },
    reasoned("a"),
    { role: "tool", tool_call_id: "a", content: long },
    shot("a"),
    reasoned("b"),
    { role: "tool", tool_call_id: "b", content: long },
    shot("b"),
    reasoned("c"),
  ];
  const messages = build();
  assert.equal(trim_tool_messages(messages, trim_model("anthropic/claude-sonnet-5.5")), true);
  assert.equal(messages[2]?.role === "tool" && messages[2].content, trimmed_stub);
  assert.deepEqual(parts(messages[3])[1], { type: "text", text: screenshot_stub });
  assert.equal(messages[5]?.role === "tool" && messages[5].content, long);
  assert.equal(parts(messages[6])[1]?.type, "image_url");
  const reasoning = messages.filter((message): message is ApiAssistantMessage => message.role === "assistant").map((message) => Boolean(message.reasoning_details));
  assert.deepEqual(reasoning, [true, false, false]);
  const other = build();
  trim_tool_messages(other, trim_model("google/gemini-3.8-flash"));
  assert.deepEqual(other.filter((message): message is ApiAssistantMessage => message.role === "assistant").map((message) => Boolean(message.reasoning_details)), [true, true, true]);
});

test("over the many-image edge every larger image is scaled down with a note instead of being left out", async () => {
  const limit: ImageLimit = { ...none, edges: [{ min_images: 1, max_edge: 8000 }, { min_images: 21, max_edge: 2000 }] };
  const edges: number[] = [];
  const shrink: ImageShrinker = async (_url, edge) => {
    edges.push(edge);
    return { url: png_url(2000, 1250), size: { width: 2000, height: 1250 } };
  };
  const twenty: ApiMessage[] = [{ role: "system", content: "s" }, ...Array.from({ length: 20 }, (_, index) => shot(`s${index}`, png_url(2420, 1512)))];
  assert.equal(await shrink_images(twenty, limit, shrink, false), false);
  assert.deepEqual(edges, []);
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, attachment(png_url(800, 600)), ...Array.from({ length: 20 }, (_, index) => shot(`s${index}`, png_url(2420, 1512))), reasoned("c1")];
  assert.equal(await shrink_images(messages, limit, shrink, true), true);
  assert.equal(edges.length, 20);
  assert.ok(edges.every((edge) => edge === 2000));
  assert.equal(images(messages), 21);
  assert.deepEqual(parts(messages[2]), [
    { type: "text", text: "[Screenshot s0]" },
    { type: "image_url", image_url: { url: png_url(2000, 1250) } },
    { type: "text", text: "[The image above was scaled down from 2420x1512 px to 2000x1250 px: with 21 images in one request the provider accepts at most 2000 px per side.]" },
  ]);
  assert.equal(parts(messages[1]).length, 2);
  assert.equal((messages[22] as ApiAssistantMessage).reasoning_details, undefined);
  assert.equal(fit_images(messages, limit, body(messages), false), false);
});

test("an image the shrinker cannot rescale is still left out by the edge rule", async () => {
  const limit: ImageLimit = { ...none, edges: [{ min_images: 2, max_edge: 2000 }] };
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, shot("a", png_url(2400, 1500)), shot("b", png_url(100, 100))];
  assert.equal(await shrink_images(messages, limit, async () => null, false), false);
  assert.equal(fit_images(messages, limit, body(messages), false), true);
  assert.equal(left_out(messages[1]), 1);
});

test("an image over the per-image byte limit is scaled down until it fits instead of being left out", async () => {
  const limit: ImageLimit = { ...none, max_encoded_bytes: 5000 };
  const big = png_url(2400, 1500, 6000);
  const edges: number[] = [];
  const shrink: ImageShrinker = async (_url, edge) => {
    edges.push(edge);
    return edge > 1000 ? { url: png_url(edge, edge, 6000), size: { width: edge, height: edge } } : { url: png_url(edge, Math.round(edge / 1.6)), size: { width: edge, height: Math.round(edge / 1.6) } };
  };
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, shot("a", big)];
  assert.equal(await shrink_images(messages, limit, shrink, false), true);
  assert.ok(edges.length >= 2 && (edges.at(-1) ?? 0) <= 1000, JSON.stringify(edges));
  const note = parts(messages[1]).at(-1);
  assert.equal(note?.type === "text" && note.text.endsWith(": the provider accepts at most 5000 bytes of encoded data per image.]"), true);
  assert.equal(fit_images(messages, limit, body(messages), false), false);
});
