import assert from "node:assert/strict";
import { test } from "node:test";
import { descendants, format_entry, is_mask_glyphs, is_protected_attributes, normalize_ref, read_ax_node, should_include, type AxNode } from "../electron/browser/ax.ts";
import { collect_frame_tree, frame_depth } from "../electron/browser/cdp.ts";
import { modifier_mask, typed_text } from "../electron/browser/input.ts";
import { analysis_cut_note, bitmap_difference, normalized_box, parse_analysis, vision_instructions } from "../electron/browser/vision.ts";

const password_node: AxNode = {
  nodeId: "7",
  backendDOMNodeId: 44,
  frameId: "frame-a",
  role: { value: "textbox" },
  name: { value: "Password" },
  value: { value: "fixture-secret" },
  properties: [
    { name: "protected", value: { value: true } },
    { name: "focused", value: { value: false } },
  ],
};

test("protected fields lose their value and are marked", () => {
  const entry = read_ax_node(password_node);
  assert.equal(entry.protected, true);
  assert.equal(entry.value, "");
  assert.equal(should_include(entry, false), true);
  assert.equal(format_entry(entry, "b1"), '[b1] textbox "Password" protected');
});

test("autocomplete password properties also protect a field", () => {
  const entry = read_ax_node({ role: { value: "textbox" }, name: { value: "PIN" }, value: { value: "1234" }, properties: [{ name: "autocomplete", value: { value: "current-password" } }] });
  assert.equal(entry.protected, true);
  assert.equal(entry.value, "");
});

test("dom attributes mark password inputs as protected", () => {
  assert.equal(is_protected_attributes(["type", "PASSWORD", "name", "pw"]), true);
  assert.equal(is_protected_attributes(["autocomplete", "new-password"]), true);
  assert.equal(is_protected_attributes(["type", "text", "autocomplete", "username"]), false);
});

test("mask glyph text under a password field is recognized", () => {
  assert.equal(is_mask_glyphs(read_ax_node({ role: { value: "StaticText" }, name: { value: "••••" } })), true);
  assert.equal(is_mask_glyphs(read_ax_node({ role: { value: "StaticText" }, name: { value: "****" } })), true);
  assert.equal(is_mask_glyphs(read_ax_node({ role: { value: "StaticText" }, name: { value: "secret" } })), false);
});

test("snapshot lines carry role, quoted text and states", () => {
  const checkbox = read_ax_node({
    role: { value: "checkbox" },
    name: { value: "  Remember\n me " },
    properties: [
      { name: "checked", value: { value: "mixed" } },
      { name: "disabled", value: { value: true } },
    ],
  });
  assert.equal(format_entry(checkbox, "b3"), '[b3] checkbox "Remember me" disabled mixed');
  const heading = read_ax_node({ role: { value: "heading" }, name: { value: 'Say "hi"' }, properties: [{ name: "level", value: { value: 2 } }] });
  assert.equal(format_entry(heading, "b4"), '[b4] heading "Say \\"hi\\"" level=2');
  const expanded = read_ax_node({ role: { value: "button" }, name: { value: "Menu" }, properties: [{ name: "expanded", value: { value: false } }] });
  assert.equal(format_entry(expanded, "b5"), '[b5] button "Menu" collapsed');
});

test("long text is cut at 800 characters inside the quotes", () => {
  const entry = read_ax_node({ role: { value: "paragraph" }, name: { value: "x".repeat(2000) } });
  assert.equal(format_entry(entry, "b1"), `[b1] paragraph "${"x".repeat(800)}"`);
});

test("inclusion keeps named interactive and content nodes only", () => {
  const ignored = read_ax_node({ ignored: true, role: { value: "button" }, name: { value: "Hidden" } });
  const nameless_button = read_ax_node({ role: { value: "button" } });
  const empty_textbox = read_ax_node({ role: { value: "textbox" } });
  const paragraph = read_ax_node({ role: { value: "paragraph" }, name: { value: "Body" } });
  const generic = read_ax_node({ role: { value: "generic" }, name: { value: "Wrapper" } });
  assert.equal(should_include(ignored, false), false);
  assert.equal(should_include(nameless_button, false), false);
  assert.equal(should_include(empty_textbox, true), true);
  assert.equal(should_include(paragraph, false), true);
  assert.equal(should_include(paragraph, true), false);
  assert.equal(should_include(generic, false), false);
});

test("refs accept the spellings models use", () => {
  assert.equal(normalize_ref("b37"), "b37");
  assert.equal(normalize_ref("B37"), "b37");
  assert.equal(normalize_ref("ref_37"), "b37");
  assert.equal(normalize_ref("REF-37"), "b37");
  assert.equal(normalize_ref("[b37]"), "b37");
  assert.equal(normalize_ref(" b0 "), "b0");
  assert.equal(normalize_ref("search-box"), "search-box");
});

test("descendants walk the child ids once", () => {
  const nodes = new Map<string, AxNode>([
    ["1", { nodeId: "1", childIds: ["2", "3"] }],
    ["2", { nodeId: "2", childIds: ["4"] }],
    ["3", { nodeId: "3", childIds: ["1"] }],
    ["4", { nodeId: "4" }],
  ]);
  assert.deepEqual([...descendants("2", nodes, new Set())].sort(), ["2", "4"]);
  assert.deepEqual([...descendants("1", nodes, new Set())].sort(), ["1", "2", "3", "4"]);
});

test("frame trees keep parents and depth", () => {
  const frames = collect_frame_tree(
    {
      frame: { id: "root", url: "https://root.test" },
      childFrames: [{ frame: { id: "child", parentId: "root", url: "https://frame.test" }, childFrames: [{ frame: { id: "nested", url: "https://nested.test" } }] }],
    },
    "",
  );
  assert.equal(frames.size, 3);
  assert.equal(frames.get("nested")?.parent_id, "child");
  assert.equal(frame_depth("root", frames), 0);
  assert.equal(frame_depth("nested", frames), 2);
});

test("typed text into protected fields is never echoed", () => {
  assert.equal(typed_text("hunter2", true), "[masked input, 7 characters]");
  assert.equal(typed_text("hello", false), '"hello"');
});

test("modifier masks follow the CDP bit layout", () => {
  assert.equal(modifier_mask([]), 0);
  assert.equal(modifier_mask(["Control", "Shift"]), 10);
  assert.equal(modifier_mask(["Alt", "Meta"]), 5);
});

test("vision answers are parsed into clamped regions", () => {
  const analysis = parse_analysis(
    'Here: {"summary":"A login form","text":["Sign in"],"regions":[{"label":"Sign in button","box":[-5,200,1400,800],"confidence":2},{"label":"too small","box":[100,100,100,500],"confidence":0.9},{"label":"bad","box":"x"}]}',
    false,
  );
  assert.equal(analysis.summary, "A login form");
  assert.deepEqual(analysis.text, ["Sign in"]);
  assert.equal(analysis.regions.length, 1);
  assert.deepEqual(analysis.regions[0], { ref: "v1", label: "Sign in button", box: [0, 0.2, 1, 0.8], confidence: 1 });
});

test("a vision answer without JSON becomes a summary without regions", () => {
  const analysis = parse_analysis("I see a page with a red banner.", false);
  assert.equal(analysis.summary, "I see a page with a red banner.");
  assert.deepEqual(analysis.regions, []);
  assert.match(vision_instructions("where is the button?"), /Question: where is the button\?$/);
  const long_question = "q".repeat(5000);
  assert.ok(vision_instructions(long_question).endsWith(`Question: ${long_question}`));
});

test("a vision answer cut at the output limit says so instead of passing as a plain summary", () => {
  const cut = parse_analysis('{"summary":"A dashboard with three charts","text":["Revenue"],"regions":[{"label":"Export button","box":[10,20', true);
  assert.deepEqual(cut.regions, []);
  assert.ok(cut.summary.startsWith(analysis_cut_note));
  assert.match(cut.summary, /No regions could be read from the cut answer/);
  assert.match(cut.summary, /A dashboard with three charts/);
  const long = "x".repeat(9000);
  assert.equal(parse_analysis(long, false).summary.length, 9000);
  const parsed = parse_analysis('{"summary":"Login page","text":[],"regions":[{"label":"Sign in","box":[100,100,200,300],"confidence":0.9}]}', true);
  assert.equal(parsed.regions.length, 1);
  assert.equal(parsed.summary, `${analysis_cut_note} Login page`);
});

test("vision boxes and bitmap differences", () => {
  assert.deepEqual(normalized_box([100, 200, 300, 400]), [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(normalized_box([613, 851, 679, 938, 0.95]), [0.613, 0.851, 0.679, 0.938]);
  assert.equal(normalized_box([100, 200, 300]), null);
  assert.equal(normalized_box([100, "x", 300, 400]), null);
  const same = Buffer.from([0, 10, 20, 255, 50, 60, 70, 255]);
  const changed = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255]);
  assert.equal(bitmap_difference(same, same), 0);
  assert.ok(bitmap_difference(same, changed) > 0.5);
  assert.equal(bitmap_difference(same, Buffer.from([0, 0, 0, 0])), 1);
});

test("every region and text entry of a vision answer reaches the model in full", () => {
  const regions = Array.from({ length: 120 }, (_, index) => ({ label: `${"l".repeat(300)} ${index}`, box: [10, 10, 500, 500], confidence: 0.9 }));
  const text = Array.from({ length: 250 }, (_, index) => `${"t".repeat(700)} ${index}`);
  const analysis = parse_analysis(JSON.stringify({ summary: "s", text, regions }), false);
  assert.equal(analysis.regions.length, 120);
  assert.equal(analysis.regions[119]?.label, `${"l".repeat(300)} 119`);
  assert.deepEqual(analysis.text, text);
});
