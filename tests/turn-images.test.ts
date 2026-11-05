import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamEventBody } from "../shared/events.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { Settings } from "../shared/settings.ts";
import type { ApiMessage, ApiUserMessage, RoundRequest, RoundResult } from "../electron/model/types.ts";
import type { Tool, ToolContext, ToolImage } from "../electron/tools/types.ts";
import { edge_rule } from "../shared/image-fit.ts";
import { native_size } from "../shared/image-native.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import type { StreamFn, TurnSession } from "../electron/turn/session.ts";
import { review_stub } from "./review-stub.ts";

const model = (vision: boolean, id = "m"): ModelEntry => ({
  id,
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

const completed = (over: Partial<RoundResult>): RoundResult => ({
  status: "completed",
  content: "",
  reasoning: "",
  reasoning_details: [],
  tool_calls: [],
  finish_reason: "stop",
  usage: null,
  ...over,
});

const shot = (name: string): ToolImage => ({ bytes: Buffer.from(`jpeg-${name}`), mime: "image/jpeg", label: `[Screenshot ${name}]` });

const image_tool = (name: string, images: ToolImage[]): Tool => ({
  spec: { name, description: "", parameters: { type: "object", properties: {} } },
  profiles: ["main"],
  available: () => true,
  execute: async () => ({ status: "done", text: `${name} text`, view: null, images }),
});

type Run = { events: StreamEventBody[]; requests: ApiMessage[][]; messages: ApiMessage[]; stored: ToolImage[][] };

const run = async (entry: ModelEntry, tools: Tool[], store: TurnSession["store_images"] | "none", history: ApiMessage[] = []): Promise<Run> => {
  const events: StreamEventBody[] = [];
  const requests: ApiMessage[][] = [];
  const stored: ToolImage[][] = [];
  let round = 0;
  const stream: StreamFn = async (request: RoundRequest) => {
    requests.push(structuredClone(request.messages));
    round += 1;
    if (round > 1) {
      return completed({ content: "done" });
    }
    return completed({ tool_calls: tools.map((tool, index) => ({ index, id: `p${index}`, name: tool.spec.name, arguments: "{}" })), finish_reason: "tool_calls" });
  };
  const session: TurnSession = {
    compaction: { audience: "user", facts: async () => "" },
    chat_id: "c",
    message_id: "m1",
    user_request: "go",
    project_root: "C:/p",
    settings: {} as Settings,
    model: entry,
    effort: "high",
    mode: "auto",
    plan: false,
    signal: new AbortController().signal,
    emit: (body) => events.push(body),
    stream,
    resolve_tools: () => tools,
    side_model: async () => "",
    review: review_stub(),
    wait_decision: async () => ({ approved: true, grant: "once", feedback: "" }),
    ...(store === "none"
      ? {}
      : {
          store_images: async (images: ToolImage[]) => {
            stored.push(images);
            return store ? store(images) : [];
          },
        }),
  };
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, ...history, { role: "user", content: "go" }];
  await run_turn_loop(session, messages);
  return { events, requests, messages, stored };
};

const tool_ends = (events: StreamEventBody[]) => events.flatMap((event) => (event.type === "tool_end" ? [event] : []));

test("the next request carries the round's tool messages, then one carrier with every image in call order", async () => {
  const ids = ["img_a_1.jpg", "img_a_2.jpg", "img_a_3.jpg"];
  let next = 0;
  const result = await run(model(true), [image_tool("first", [shot("s1"), shot("s2")]), image_tool("second", [shot("s3")])], async (images) => images.map(() => ids[next++] ?? ""));
  const second = result.requests[1] ?? [];
  assert.deepEqual(second.slice(2).map((message) => message.role), ["assistant", "tool", "tool", "user"]);
  const carrier = second.at(-1) as ApiUserMessage;
  assert.equal(carrier.tool_images, true);
  assert.deepEqual(carrier.content, [
    { type: "text", text: "[Screenshot s1]" },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from("jpeg-s1").toString("base64")}` } },
    { type: "text", text: "[Screenshot s2]" },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from("jpeg-s2").toString("base64")}` } },
    { type: "text", text: "[Screenshot s3]" },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from("jpeg-s3").toString("base64")}` } },
  ]);
  assert.deepEqual(result.stored.map((batch) => batch.map((image) => image.bytes.toString())), [["jpeg-s1", "jpeg-s2"], ["jpeg-s3"]]);
  assert.deepEqual(tool_ends(result.events).map((event) => event.images), [
    [
      { id: "img_a_1.jpg", label: "[Screenshot s1]" },
      { id: "img_a_2.jpg", label: "[Screenshot s2]" },
    ],
    [{ id: "img_a_3.jpg", label: "[Screenshot s3]" }],
  ]);
});

test("a failed image store attaches nothing of that call and says why in the tool text", async () => {
  const result = await run(model(true), [image_tool("first", [shot("s1")]), image_tool("second", [shot("s2")])], async (images) => {
    if (images[0]?.bytes.toString() === "jpeg-s1") {
      throw new Error("disk full");
    }
    return ["img_b_1.jpg"];
  });
  const ends = tool_ends(result.events);
  assert.equal(ends[0]?.images, undefined);
  assert.equal(ends[0]?.result_text, "first text\n[The screenshots of this call could not be stored and are not attached: disk full.]");
  assert.deepEqual(ends[1]?.images, [{ id: "img_b_1.jpg", label: "[Screenshot s2]" }]);
  const second = result.requests[1] ?? [];
  const tool_texts = second.flatMap((message) => (message.role === "tool" ? [message.content] : []));
  assert.equal(tool_texts[0], ends[0]?.result_text);
  const carrier = second.at(-1) as ApiUserMessage;
  assert.deepEqual(
    (carrier.content as Exclude<ApiUserMessage["content"], string>).filter((part) => part.type === "text").map((part) => (part.type === "text" ? part.text : "")),
    ["[Screenshot s2]"],
  );
});

test("a text-only model gets no carrier and nothing is stored", async () => {
  const result = await run(model(false), [image_tool("first", [shot("s1")])], async () => ["img_c_1.jpg"]);
  assert.deepEqual(result.stored, []);
  assert.equal(tool_ends(result.events)[0]?.images, undefined);
  assert.equal((result.requests[1] ?? []).some((message) => message.role === "user" && message.tool_images), false);
});

test("without an image store the carrier keeps the images inline and no step references them", async () => {
  const result = await run(model(true), [image_tool("first", [shot("s1")])], "none");
  assert.equal(tool_ends(result.events)[0]?.images, undefined);
  const carrier = result.messages.find((message) => message.role === "user" && message.tool_images) as ApiUserMessage | undefined;
  assert.equal(Array.isArray(carrier?.content) && carrier.content.some((part) => part.type === "image_url"), true);
});

test("an image over a documented provider limit is left out without a chat notice and later rounds keep it out", async () => {
  const deepseek: ModelEntry = { ...model(true, "deepseek/deepseek-v4.1-flash"), provider_order: ["deepseek"] };
  const big: ToolImage = { bytes: Buffer.alloc(25_200_000, 1), mime: "image/jpeg", label: "[Screenshot big]" };
  const result = await run(deepseek, [image_tool("first", [big])], async () => ["img_d_1.jpg"]);
  const second = result.requests[1] ?? [];
  const carrier = second.at(-1) as ApiUserMessage;
  assert.deepEqual(carrier.content, [
    { type: "text", text: "[Screenshot big]" },
    { type: "text", text: "[Image not sent: this request would exceed the provider's documented image or request size limit.]" },
  ]);
  assert.equal(result.events.filter((event) => event.type === "notice" && event.notice === "context_trimmed").length, 0);
  const kept = result.messages.find((message) => message.role === "user" && message.tool_images) as ApiUserMessage | undefined;
  assert.deepEqual(kept?.content, carrier.content);
});

test("a tool's image fit counts the images the next request will carry, so the 21st Claude image already fits the 2000 px rule", async () => {
  const claude: ModelEntry = { ...model(true, "anthropic/claude-opus-5.5"), provider_order: ["anthropic"] };
  const tiny = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 100, 0, 0, 0, 100]).toString("base64")}`;
  const history: ApiMessage[] = Array.from({ length: 19 }, () => ({ role: "user", content: [{ type: "image_url", image_url: { url: tiny } }] }));
  const seen: ToolContext["image_fit"][] = [];
  const fitting = (name: string): Tool => ({
    ...image_tool(name, []),
    execute: async (ctx) => {
      seen.push(ctx.image_fit);
      return { status: "done", text: `${name} text`, view: null, images: [shot(name)] };
    },
  });
  await run(claude, [fitting("first"), fitting("second")], "none", history);
  const opus = native_size("anthropic/claude-opus-5.5");
  assert.deepEqual(seen, [
    [opus, edge_rule(8000)],
    [opus, edge_rule(2000)],
  ]);
});
