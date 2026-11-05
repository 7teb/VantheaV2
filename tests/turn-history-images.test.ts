import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AssistantMessage, Message, StepImage, ToolStep, UserMessage } from "../shared/chat.ts";
import { default_native, type NativeSize } from "../shared/image-fit.ts";
import { native_size } from "../shared/image-native.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { ApiMessage, ApiUserMessage } from "../electron/model/types.ts";
import { carrier, image_url, without_images } from "../electron/turn/carriers.ts";
import { init_media } from "../electron/media/files.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import type { ImageReader } from "../electron/turn/user-input.ts";

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-history-images-"));
  init_media({ attachments: path.join(root, "attachments"), images: path.join(root, "images") });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const model = (vision: boolean): ModelEntry => ({
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
});

const user = (id: string, text: string): UserMessage => ({ id, role: "user", text, attachments: [], origin: "user", created_at: "2026-10-11T10:00:00.000Z" });

const tool_step = (call_id: string, round: number, images?: StepImage[]): ToolStep => ({
  id: `tool:${call_id}`,
  round,
  kind: "tool",
  index: 0,
  call_id,
  name: "browser_screenshot",
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text: `result ${call_id}`,
  ...(images ? { images } : {}),
  started_at: 1,
  ended_at: 2,
});

const assistant = (steps: ToolStep[]): AssistantMessage => ({
  id: "a1",
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-11T10:00:01.000Z",
  ended_at: "2026-10-11T10:00:05.000Z",
  status: "done",
  steps: [...steps, { id: "text:9", round: 9, kind: "text", text: "finished" }],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 5,
});

const bytes: Record<string, Buffer> = { "img_x_1.jpg": Buffer.from("first-jpeg"), "img_x_2.jpg": Buffer.from("second-jpeg") };

const reads: string[] = [];

const read_rules: NativeSize[][] = [];

const reader: ImageReader = async (id, mime, rules) => {
  reads.push(`${id} ${mime}`);
  read_rules.push(rules);
  const found = bytes[id];
  if (!found) {
    throw new Error(`missing ${id}`);
  }
  return `data:${mime};base64,${found.toString("base64")}`;
};

const replay = (messages: Message[], vision: boolean) => build_api_messages({ system: "sys", agent_tools: false, summary: null, messages, model: model(vision) }, reader);

const shots: StepImage[] = [
  { id: "img_x_1.jpg", label: "[Screenshot s1 from browser_screenshot.]" },
  { id: "img_x_2.jpg", label: "[Screenshot s2 from browser_screenshot.]" },
];

test("step images replay after the round's tool messages, byte-identical to the live carrier", async () => {
  const history = [user("u1", "look"), assistant([tool_step("c0_0", 0, [shots[0] as StepImage]), tool_step("c0_1", 0, [shots[1] as StepImage]), tool_step("c1_0", 1)]), user("u2", "next")];
  const out = await replay(history, true);
  assert.deepEqual(out.map((message) => message.role), ["system", "user", "assistant", "tool", "tool", "user", "assistant", "tool", "assistant", "user"]);
  const live = carrier(shots.map((shot) => ({ label: shot.label, url: image_url(bytes[shot.id] as Buffer, "image/jpeg") })));
  assert.equal(JSON.stringify(out[5]), JSON.stringify(live));
  assert.equal((out[5] as ApiUserMessage).tool_images, true);
});

test("a text-only model replays a note per image instead of the picture", async () => {
  reads.length = 0;
  const out = await replay([user("u1", "look"), assistant([tool_step("c0_0", 0, shots)])], false);
  const notes = out.find((message): message is ApiUserMessage => message.role === "user" && Boolean(message.tool_images));
  assert.deepEqual(notes?.content, [
    { type: "text", text: "[Screenshot s1 from browser_screenshot.] The image is not shown because the current model does not take images." },
    { type: "text", text: "[Screenshot s2 from browser_screenshot.] The image is not shown because the current model does not take images." },
  ]);
  assert.deepEqual(reads, []);
});

test("an image that cannot be read from disk replays as a note and the rest still replays", async () => {
  const lost: StepImage = { id: "img_x_9.jpg", label: "[Screenshot s9]" };
  const out = await replay([user("u1", "look"), assistant([tool_step("c0_0", 0, [lost, shots[0] as StepImage])])], true);
  const parts = out.find((message): message is ApiUserMessage => message.role === "user" && Boolean(message.tool_images))?.content;
  assert.deepEqual(parts, [
    { type: "text", text: "[Screenshot s9] The image could not be read from disk." },
    { type: "text", text: "[Screenshot s1 from browser_screenshot.]" },
    { type: "image_url", image_url: { url: image_url(bytes["img_x_1.jpg"] as Buffer, "image/jpeg") } },
  ]);
});

test("steps without images replay exactly as before", async () => {
  const out = await replay([user("u1", "look"), assistant([tool_step("c0_0", 0)])], true);
  assert.equal(out.some((message) => message.role === "user" && message.tool_images), false);
  assert.deepEqual(out.map((message) => message.role), ["system", "user", "assistant", "tool", "assistant"]);
});

test("the image reader gets the media id and the mime type", async () => {
  reads.length = 0;
  const image_attachment = { id: "img_x_2.jpg", kind: "image" as const, name: "a.jpg", mime: "image/png", size: 3, vision_note: null };
  await replay([{ ...user("u1", "look"), attachments: [image_attachment] }, assistant([tool_step("c0_0", 0, [shots[0] as StepImage])])], true);
  assert.deepEqual(reads, ["img_x_2.jpg image/png", "img_x_1.jpg image/jpeg"]);
});

test("the image reader gets the model copy with its own mime and the tag names the size the model's native fit allows", async () => {
  reads.length = 0;
  read_rules.length = 0;
  const image_attachment = { id: "img_x_9.png", kind: "image" as const, name: "big.png", mime: "image/png", size: 3, vision_note: null, width: 4000, height: 3000, model: { id: "img_x_1.jpg", width: 1386, height: 1040 } };
  const out = await replay([{ ...user("u1", "look"), attachments: [image_attachment] }], true);
  assert.deepEqual(reads, ["img_x_1.jpg image/jpeg"]);
  assert.deepEqual(read_rules, [[default_native]]);
  const parts = (out[1] as ApiUserMessage).content;
  assert.ok(Array.isArray(parts));
  assert.match(parts[0]?.type === "text" ? parts[0].text : "", /size="4000x3000" sent="1314x986"/);
});

test("a Claude model reads attachments and replayed screenshots with its own native size", async () => {
  reads.length = 0;
  read_rules.length = 0;
  const claude = { ...model(true), id: "anthropic/claude-opus-5.5" };
  const image_attachment = { id: "img_x_9.png", kind: "image" as const, name: "big.png", mime: "image/png", size: 3, vision_note: null, width: 4000, height: 3000, model: { id: "img_x_2.jpg", width: 2236, height: 1677 } };
  const history = [{ ...user("u1", "look"), attachments: [image_attachment] }, assistant([tool_step("c0_0", 0, [shots[0] as StepImage])])];
  const out = await build_api_messages({ system: "sys", agent_tools: false, summary: null, messages: history, model: claude }, reader);
  const high = native_size(claude.id);
  assert.deepEqual(read_rules, [[high], [high]]);
  const parts = (out[1] as ApiUserMessage).content;
  assert.ok(Array.isArray(parts));
  assert.match(parts[0]?.type === "text" ? parts[0].text : "", /size="4000x3000" sent="2212x1659"/);
});

test("a stored agent context loses its pictures for a model without vision", () => {
  const stored: ApiMessage[] = [{ role: "user", content: "task" }, carrier([{ label: "[Screenshot s1]", url: "data:image/jpeg;base64,AAAA" }])];
  const converted = without_images(stored);
  assert.deepEqual(converted[1], {
    role: "user",
    tool_images: true,
    content: [
      { type: "text", text: "[Screenshot s1]" },
      { type: "text", text: "The image is not shown because the current model does not take images." },
    ],
  });
  assert.equal(converted[0], stored[0]);
});
