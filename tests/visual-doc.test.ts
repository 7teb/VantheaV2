import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { read_visual_message, visual_csp, visual_document, visual_height_limit, visual_message_source, visual_shell } from "../shared/visual-doc.ts";

const vars = "--vx-text: #fcfcfc; --vx-accent: #a67df2;";

const code = '<div id="chart"></div>\n<script>document.getElementById("chart").textContent = "a < b && c";</script>';

const csp_meta = `<meta http-equiv="Content-Security-Policy" content="${visual_csp}">`;

const head_of = (doc: string) => doc.slice(doc.indexOf("<head>"), doc.indexOf("</head>"));

const body_of = (doc: string) => doc.slice(doc.indexOf("<body>") + "<body>".length, doc.lastIndexOf("</body>"));

test("the policy blocks every network path and allows only inline script and style", () => {
  assert.equal(
    visual_csp,
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'",
  );
});

test("the document starts with a doctype and puts charset and the policy first in head", () => {
  const doc = visual_document(code, vars);
  assert.ok(doc.startsWith("<!doctype html>"));
  const head = head_of(doc);
  assert.ok(head.indexOf('<meta charset="utf-8">') < head.indexOf(csp_meta));
  assert.ok(head.includes(csp_meta));
  assert.ok(doc.indexOf(csp_meta) < doc.indexOf(code));
  assert.ok(doc.indexOf("</head>") < doc.indexOf(code));
});

test("the reporter script runs before the model code and speaks the shared message shape", () => {
  const doc = visual_document(code, vars);
  const reporter = doc.indexOf("<script>");
  assert.ok(reporter > 0 && reporter < doc.indexOf("</head>"));
  assert.ok(reporter < doc.indexOf(code));
  const script = doc.slice(reporter, doc.indexOf("</script>", reporter));
  assert.ok(script.includes(JSON.stringify(visual_message_source)));
  for (const hook of ["DOMContentLoaded", "\"load\"", "document.fonts.ready", "ResizeObserver", "\"error\"", "unhandledrejection"]) {
    assert.ok(script.includes(hook), hook);
  }
});

test("the model code lands verbatim inside body", () => {
  const doc = visual_document(code, vars);
  assert.equal(body_of(doc).trim(), code);
});

test("a full document from the model still lands inside body after our head", () => {
  const full = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><style>body{color:red}</style></head><body><p>hi</p></body></html>';
  const doc = visual_document(full, vars);
  const ours = doc.indexOf(csp_meta);
  const theirs = doc.indexOf(full);
  assert.ok(ours > 0 && ours < doc.indexOf("</head>"));
  assert.ok(theirs > doc.indexOf("<body>"));
  assert.equal(head_of(doc).includes("default-src *"), false);
});

test("the variables land in the style block on :root with the dark color scheme", () => {
  const doc = visual_document(code, vars);
  const style = doc.slice(doc.indexOf("<style>"), doc.indexOf("</style>"));
  assert.ok(doc.indexOf("<style>") < doc.indexOf("</head>"));
  assert.ok(style.includes(`:root { color-scheme: dark; ${vars} }`));
  assert.match(style, /html \{[^}]*overflow: hidden[^}]*background: transparent/);
  assert.match(style, /body \{[^}]*background: transparent;[^}]*color: var\(--vx-text\);[^}]*font-family: var\(--vx-font\);[^}]*font-size: var\(--vx-size-body\);/);
});

test("only ready, height and error messages from our frame are accepted", () => {
  assert.deepEqual(read_visual_message({ source: visual_message_source, ready: true }), { kind: "ready" });
  assert.deepEqual(read_visual_message({ source: visual_message_source, height: 120.2 }), { kind: "height", height: 121 });
  assert.deepEqual(read_visual_message({ source: visual_message_source, height: 0 }), { kind: "height", height: 0 });
  assert.deepEqual(read_visual_message({ source: visual_message_source, error: "boom" }), { kind: "error", error: "boom" });
  assert.equal(read_visual_message({ source: visual_message_source, error: "x".repeat(900) })?.kind, "error");
  assert.equal((read_visual_message({ source: visual_message_source, error: "x".repeat(900) }) as { error: string }).error.length, 300);
  for (const data of [
    { height: 10 },
    { source: "other", height: 10 },
    { source: visual_message_source, height: -1 },
    { source: visual_message_source, height: Number.NaN },
    { source: visual_message_source, height: Number.POSITIVE_INFINITY },
    { source: visual_message_source, height: "10" },
    { source: visual_message_source, error: 5 },
    { source: visual_message_source, ready: "yes" },
    { ready: true },
    { source: visual_message_source },
    null,
    "vx-visual",
    42,
  ]) {
    assert.equal(read_visual_message(data), null, JSON.stringify(data));
  }
});

test("a posted height is capped so a widget cannot stretch the chat without end", () => {
  assert.deepEqual(read_visual_message({ source: visual_message_source, height: 1e12 }), { kind: "height", height: visual_height_limit });
  assert.deepEqual(read_visual_message({ source: visual_message_source, height: visual_height_limit - 0.5 }), { kind: "height", height: visual_height_limit });
});

test("the shell page carries the same policy before its only script", () => {
  assert.ok(visual_shell.startsWith("<!doctype html>"));
  const head = head_of(visual_shell);
  assert.ok(head.indexOf('<meta charset="utf-8">') < head.indexOf(csp_meta));
  assert.ok(head.includes('<meta name="color-scheme" content="dark">'));
  assert.equal(visual_shell.split("<script>").length, 2);
  assert.ok(visual_shell.indexOf("</head>") < visual_shell.indexOf("<script>"));
});

type Listener = (event: Record<string, unknown>) => void;

const shell_sandbox = () => {
  const start = visual_shell.indexOf("<script>") + "<script>".length;
  const script = visual_shell.slice(start, visual_shell.indexOf("</script>", start));
  const listeners: Listener[] = [];
  const posted: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const parent = { postMessage: (message: Record<string, unknown>, target: string) => posted.push({ ...message, target }) };
  const context: Record<string, unknown> = {
    parent,
    addEventListener: (name: string, listener: Listener) => name === "message" && listeners.push(listener),
    document: { open: () => calls.push("open"), write: (text: string) => calls.push(`write:${text}`), close: () => calls.push("close") },
  };
  vm.runInNewContext(script, context);
  const send = (source: unknown, data: unknown) => listeners.forEach((listener) => listener({ source, data }));
  return { parent, posted, calls, send };
};

test("the shell asks for its document once and writes only the first string from its parent", () => {
  const shell = shell_sandbox();
  assert.deepEqual(shell.posted, [{ source: visual_message_source, ready: true, target: "*" }]);
  shell.send({}, "<p>other</p>");
  shell.send(shell.parent, { html: "<p>x</p>" });
  assert.deepEqual(shell.calls, []);
  shell.send(shell.parent, "<p>first</p>");
  shell.send(shell.parent, "<p>second</p>");
  assert.deepEqual(shell.calls, ["open", "write:<p>first</p>", "close"]);
});

const reporter_sandbox = () => {
  const doc = visual_document("", "");
  const start = doc.indexOf("<script>") + "<script>".length;
  const script = doc.slice(start, doc.indexOf("</script>", start));
  const listeners = new Map<string, Listener[]>();
  const posted: Record<string, unknown>[] = [];
  const timers: (() => void)[] = [];
  const observed: (() => void)[] = [];
  const body = { height: 0, scrollHeight: 0, getBoundingClientRect: () => ({ top: 0, height: body.height }) };
  const context: Record<string, unknown> = {
    innerWidth: 600,
    innerHeight: 0,
    scrollY: 0,
    parent: { postMessage: (message: Record<string, unknown>, target: string) => posted.push({ ...message, target }) },
    addEventListener: (name: string, listener: Listener) => listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    getComputedStyle: () => ({ marginBottom: "0px" }),
    setTimeout: (run: () => void) => timers.push(run),
    ResizeObserver: class {
      constructor(callback: () => void) {
        observed.push(callback);
      }
      observe() {}
    },
    document: { body: null, documentElement: {}, fonts: { ready: new Promise(() => {}) } },
  };
  context.window = context;
  vm.runInNewContext(script, context);
  const fire = (name: string, event: Record<string, unknown> = {}) => (listeners.get(name) ?? []).forEach((listener) => listener(event));
  const grow = (height: number) => {
    body.height = height;
    body.scrollHeight = height;
    observed.forEach((callback) => callback());
  };
  const frame = (width: number, height: number) => {
    context.innerWidth = width;
    context.innerHeight = height;
    fire("resize");
  };
  const settle = () => timers.splice(0).forEach((run) => run());
  const load = (height: number) => {
    (context.document as { body: unknown }).body = body;
    body.height = height;
    body.scrollHeight = height;
    fire("DOMContentLoaded");
  };
  return { posted, fire, grow, frame, settle, load };
};

test("the reporter posts content height once per change and ignores growth that only follows its own frame", () => {
  const sandbox = reporter_sandbox();
  sandbox.load(200);
  sandbox.grow(200);
  assert.deepEqual(sandbox.posted, [{ source: visual_message_source, height: 200, target: "*" }]);
  sandbox.frame(600, 200);
  sandbox.grow(220);
  sandbox.settle();
  assert.equal(sandbox.posted.length, 1);
  sandbox.grow(260);
  sandbox.frame(500, 260);
  sandbox.grow(300);
  sandbox.settle();
  sandbox.frame(500, 300);
  sandbox.grow(150);
  assert.deepEqual(sandbox.posted.map((message) => message.height), [200, 260, 300, 150]);
});

test("the reporter forwards script errors and rejections with capped text", () => {
  const sandbox = reporter_sandbox();
  sandbox.fire("error", { message: "x".repeat(500), error: new Error("x") });
  sandbox.fire("unhandledrejection", { reason: new Error("nope") });
  assert.equal((sandbox.posted[0].error as string).length, 300);
  assert.equal(sandbox.posted[1].error, "Error: nope");
  assert.equal(sandbox.posted[1].source, visual_message_source);
});

test("the reporter ignores error events without an exception, like the ResizeObserver loop notice", () => {
  const sandbox = reporter_sandbox();
  sandbox.fire("error", { message: "ResizeObserver loop completed with undelivered notifications.", error: null });
  assert.equal(sandbox.posted.length, 0);
  sandbox.fire("error", { message: "Uncaught ReferenceError: chart is not defined", error: new ReferenceError("chart is not defined") });
  assert.equal(sandbox.posted[0].error, "Uncaught ReferenceError: chart is not defined");
});

test("the reporter cancels clicks on links so a widget never navigates its frame", () => {
  const sandbox = reporter_sandbox();
  const click = (link: boolean) => {
    let cancelled = false;
    sandbox.fire("click", { target: { closest: (selector: string) => (link && selector === "a[href]" ? {} : null) }, preventDefault: () => (cancelled = true) });
    return cancelled;
  };
  assert.equal(click(true), true);
  assert.equal(click(false), false);
});
