import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attachment } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import { completed, ends, harness, make_tool, queue_steers, tool_call, transcript, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

const settle = async () => {
  for (let index = 0; index < 10; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const menu: Attachment = { id: "img_steer_9f8e7d6c.png", kind: "image", name: "menu.png", mime: "image/png", size: 10, vision_note: null };

const steer_texts = (events: StreamEventBody[]) => events.flatMap((event) => (event.type === "steer" ? [event.text] : []));

const last_text = (messages: ApiMessage[]) => {
  const last = messages.at(-1);
  return typeof last?.content === "string" ? last.content : "";
};

test("a steer that arrives during the final answer gets another round instead of being dropped", async () => {
  let call = 0;
  const h = harness(async (request) => {
    call += 1;
    if (call === 1) {
      steers.push("also check the docs");
      return completed({ content: "done" });
    }
    return completed({ content: last_text(request.messages).includes("also check the docs") ? "checked" : "missed" });
  }, []);
  const steers = queue_steers(h);
  await run_turn_loop(h.session, h.messages);
  assert.equal(call, 2);
  assert.ok(h.events.some((event) => event.type === "steer" && event.text === "also check the docs"));
  assert.equal(h.messages.at(-1)?.content, "checked");
  assert.equal(ends(h.events).length, 1);
});

test("a steer with an image reaches the model with the image and keeps it on the steer step", async () => {
  const image: Attachment = { id: "att_steer_0a1b2c3d.png", kind: "image", name: "reference.png", mime: "image/png", size: 10, vision_note: "A red login button." };
  let seen = "";
  let call = 0;
  const h = harness(async (request) => {
    call += 1;
    if (call === 1) {
      steers.push("use this as reference", [image]);
      return completed({ content: "working" });
    }
    seen = last_text(request.messages);
    return completed({ content: "done" });
  }, []);
  const steers = queue_steers(h);
  await run_turn_loop(h.session, h.messages);
  assert.equal(call, 2);
  assert.match(seen, /use this as reference/);
  assert.match(seen, /reference\.png[\s\S]*A red login button\./);
  const step = transcript(h.events).steps.find((entry) => entry.kind === "steer");
  assert.deepEqual(step?.kind === "steer" ? step.attachments : null, [image]);
});

test("a steer that arrives while a plan is presented gets another round", async () => {
  let call = 0;
  const stream: StreamFn = async () => {
    call += 1;
    return call === 1 ? completed({ tool_calls: [tool_call("present_plan")], finish_reason: "tool_calls" }) : completed({ content: "adjusted" });
  };
  const h = harness(stream, [], true);
  const steers = queue_steers(h);
  const present = make_tool("present_plan", async () => {
    steers.push("use sqlite instead");
    return { status: "done", text: "planned", view: { kind: "plan", text: "do it" } };
  });
  h.session.resolve_tools = () => [present];
  await run_turn_loop(h.session, h.messages);
  assert.equal(call, 2);
  assert.equal(ends(h.events).length, 1);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});

test("a steer event comes before its message and carries the attachments its note resolved", async () => {
  let call = 0;
  let event_at = -1;
  const h = harness(async () => {
    call += 1;
    if (call === 1) {
      steers.push("see this", [menu]);
      return completed({ content: "working" });
    }
    return completed({ content: "done" });
  }, []);
  const steers = queue_steers(h, async (steer) => steer.attachments.map((attachment) => ({ ...attachment, vision_note: "A glass menu." })));
  h.session.emit = (body) => {
    h.events.push(body);
    if (body.type === "steer") {
      event_at = h.messages.length;
    }
  };
  await run_turn_loop(h.session, h.messages);
  const event = h.events.find((entry) => entry.type === "steer");
  assert.deepEqual(event?.type === "steer" ? event.attachments?.map((attachment) => attachment.vision_note) : null, ["A glass menu."]);
  const message = h.messages[event_at];
  assert.equal(message?.role === "user" && message.steer, true);
  assert.match(typeof message?.content === "string" ? message.content : "", /see this\n\n<image name="menu\.png"[\s\S]*A glass menu\.\n<\/image>$/);
  assert.equal(steers.queued.length, 0);
  assert.equal(ends(h.events).length, 1);
});

test("a steer whose note is still running is awaited and a steer pushed meanwhile is taken in the same call, in order", async () => {
  let release: (attachments: Attachment[]) => void = () => undefined;
  const pending = new Promise<Attachment[]>((resolve) => {
    release = resolve;
  });
  let call = 0;
  const h = harness(async () => {
    call += 1;
    if (call === 1) {
      steers.push("first", [menu]);
      return completed({ content: "working" });
    }
    return completed({ content: "done" });
  }, []);
  const steers = queue_steers(h, (steer) => (steer.text === "first" ? pending : Promise.resolve(steer.attachments)));
  const done = run_turn_loop(h.session, h.messages);
  await settle();
  assert.deepEqual(steer_texts(h.events), []);
  assert.equal(call, 1);
  steers.push("second");
  release([{ ...menu, vision_note: "noted" }]);
  await done;
  assert.deepEqual(steer_texts(h.events), ["first", "second"]);
  assert.deepEqual(h.events.flatMap((event) => (event.type === "steer" ? [event.round] : [])), [1, 1]);
  assert.equal(call, 2);
  assert.equal(ends(h.events).length, 1);
});

test("stopping while a steer's note is pending emits no steer, leaves it queued and ends stopped", async () => {
  let call = 0;
  const h = harness(async () => {
    call += 1;
    steers.push("first", [menu]);
    return completed({ content: "working" });
  }, []);
  const steers = queue_steers(h, () => new Promise<Attachment[]>((resolve) => h.controller.signal.addEventListener("abort", () => resolve([]), { once: true })));
  const done = run_turn_loop(h.session, h.messages);
  await settle();
  h.controller.abort(new Error("the user stopped the turn"));
  await done;
  assert.deepEqual(steer_texts(h.events), []);
  assert.deepEqual(steers.queued.map((steer) => steer.text), ["first"]);
  assert.equal(call, 1);
  assert.equal(ends(h.events).length, 1);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "stopped");
});

test("an error thrown after the user stopped the turn ends it stopped, not failed", async () => {
  const h = harness(async () => completed({ content: "never" }), []);
  const steers = queue_steers(h, async () => {
    h.controller.abort(new Error("the user stopped the turn"));
    throw new Error("attachment read failed");
  });
  steers.push("look at this");
  await run_turn_loop(h.session, h.messages);
  assert.equal(ends(h.events).length, 1);
  assert.deepEqual(ends(h.events)[0], { type: "end", status: "stopped", error: null });
});

test("stopping while a steer's note is pending after a presented plan ends stopped, not done", async () => {
  const h = harness(async () => completed({ tool_calls: [tool_call("present_plan")], finish_reason: "tool_calls" }), [], true);
  const steers = queue_steers(h, () => new Promise<Attachment[]>((resolve) => h.controller.signal.addEventListener("abort", () => resolve([]), { once: true })));
  h.session.resolve_tools = () => [
    make_tool("present_plan", async () => {
      steers.push("use sqlite", [menu]);
      return { status: "done", text: "planned", view: { kind: "plan", text: "do it" } };
    }),
  ];
  const done = run_turn_loop(h.session, h.messages);
  await settle();
  h.controller.abort(new Error("the user stopped the turn"));
  await done;
  assert.deepEqual(steer_texts(h.events), []);
  assert.equal(ends(h.events).length, 1);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "stopped");
});
