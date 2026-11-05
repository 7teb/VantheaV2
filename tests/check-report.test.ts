import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageFacts } from "../electron/check/facts.ts";
import type { RgbImage } from "../electron/check/png.ts";
import { py_fixed, py_str } from "../electron/check/py-format.ts";
import { check_report, result_line, type LiveData } from "../electron/check/report.ts";
import { fixture_images, pillow } from "./check-images.ts";

const images = fixture_images();

const shots_dir = "D:\\proj\\out\\particles\\_shots";

const live = (overrides: Partial<LiveData> = {}): LiveData => ({
  errors: [],
  blocked: [],
  interactions: 4,
  layout: { stage: [1100, 520], horizontal_overflow: false, zero_size_canvases: 0 },
  narrow_overflow: false,
  phone_overflow: false,
  scenes: null,
  ad_format: null,
  ...overrides,
});

const page: PageFacts = { is_ad: false, brief_scenes: 0, uses_timeline: false };

const ad: PageFacts = { is_ad: true, brief_scenes: 3, uses_timeline: true };

const shots = (entries: [string, RgbImage][]) => new Map(entries);

const scene_a = pillow.analyze.scene_a;

const noise = pillow.analyze.noise;

test("a clean page prints the stats, idle and pointer lines with Python's number formats and passes", () => {
  const report = check_report(live(), shots([["wide_a", images.scene_a], ["wide_still", images.scene_b], ["wide_b", images.scene_a], ["narrow", images.noise], ["phone", images.noise]]), page, shots_dir);
  const motion = pillow.motion["scene_a|scene_b"].value_3f;
  assert.deepEqual(report.lines, [
    `      stats modal=${scene_a.modal_2f} colors=${scene_a.colors} edges=${scene_a.edges_1f} interactions=4 stage after the controls were used=[1100, 520]`,
    `      idle motion changed_pixels=${motion} (no pointer, 1.5s apart)`,
    `      pointer reaction changed_pixels=${motion}`,
    `      screenshots in ${shots_dir}`,
  ]);
  assert.equal(report.lines[0], "      stats modal=0.01 colors=3993 edges=24.8 interactions=4 stage after the controls were used=[1100, 520]");
  assert.equal(result_line(report), "result: PASS  (0 fail, 0 warn). Browser check only; check.py does the source lint.");
});

test("every live_check FAIL and WARN of a broken page appears in check.py's order with its text", () => {
  const errors = ["exception app.js:12 TypeError: x is not a function  (x3)", "e2", "e3", "e4", "e5", "e6", "e7", "e8"];
  const data = live({
    errors,
    blocked: ["https://cdn.example.com/lib.js", "https://example.com/data.json"],
    interactions: 1,
    layout: { stage: [400, 200], horizontal_overflow: true, zero_size_canvases: 2 },
    narrow_overflow: true,
    phone_overflow: true,
  });
  const report = check_report(data, shots([["wide_a", images.dark], ["wide_still", images.dark], ["narrow", images.flat]]), page, shots_dir);
  const dark = pillow.analyze.dark;
  assert.deepEqual(report.lines, [
    ...errors.slice(0, 6).map((error) => `FAIL  runtime: ${error}`),
    "WARN  blocked a request to https://cdn.example.com/lib.js, check_page allows only Google Fonts",
    "WARN  blocked a request to https://example.com/data.json, check_page allows only Google Fonts",
    "WARN  fewer than 2 controls or stage interactions were found, are the controls inside .controls?",
    "FAIL  2 canvas has zero size, the stage will be blank",
    "FAIL  page scrolls sideways at 1440 wide",
    "FAIL  page scrolls sideways at 800 wide",
    "WARN  page scrolls sideways at 390 wide (phone)",
    "WARN  stage is only 400x200, too small to show anything",
    `      stats modal=${dark.modal_2f} colors=1 edges=${dark.edges_1f} interactions=1 stage after the controls were used=[400, 200]`,
    "FAIL  screenshot is almost one flat color, the page looks blank",
    "WARN  only 1 distinct colors, looks flat",
    "      idle motion changed_pixels=0.000 (no pointer, 1.5s apart)",
    "WARN  nothing moves on its own when the pointer is away, add idle motion from time",
    "FAIL  800px wide screenshot is blank",
    `      screenshots in ${shots_dir}`,
  ]);
  assert.equal(report.fails, 11);
  assert.equal(report.warns, 7);
  assert.equal(result_line(report), "result: FAIL  (11 fail, 7 warn). Browser check only; check.py does the source lint.");
});

test("without wide_a the report stops after the layout lines, like live_check's early return", () => {
  const report = check_report(live({ layout: null, interactions: 0 }), shots([]), page, shots_dir);
  assert.deepEqual(report.lines, [
    "WARN  fewer than 2 controls or stage interactions were found, are the controls inside .controls?",
    "FAIL  the live check produced no screenshots",
  ]);
  assert.equal(check_report(live({ layout: { stage: null, horizontal_overflow: false, zero_size_canvases: 0 } }), shots([["wide_a", images.noise]]), page, shots_dir).lines[0], `      stats modal=${noise.modal_2f} colors=${noise.colors} edges=${noise.edges_1f} interactions=4 stage after the controls were used=None`);
});

test("an ad without a format and without scenes warns with None and fails the timeline", () => {
  const report = check_report(live({ layout: { stage: [300, 300], horizontal_overflow: false, zero_size_canvases: 0 } }), shots([["wide_a", images.noise]]), { ...ad, uses_timeline: false }, shots_dir);
  assert.deepEqual(report.lines.slice(1), [
    "      check_page clicked every control in page order, the ad ended in format None",
    "WARN  the last Format button check_page clicked was expected to set 9:16, the ad ended in None. Keep the Format buttons in the order 16:9, 1:1, 9:16 and check the data-format handler, otherwise 9:16 was not verified",
    "      scenes seen over the playback: []",
    "FAIL  the timeline never left scene 0 during about 20 seconds. Check dur values, the total must be 16 seconds or less, and that timeline() is called",
    `      screenshots in ${shots_dir}`,
  ]);
});

test("an ad that missed a brief scene warns with Python list reprs and prints the scene to scene change", () => {
  const data = live({ ad_format: "1:1", scenes: ["0", "1", "0", "1"] });
  const report = check_report(data, shots([["scene_01_s1", images.scene_b], ["wide_a", images.noise], ["scene_00_s0", images.scene_a]]), ad, shots_dir);
  assert.deepEqual(report.lines.slice(1), [
    "      check_page clicked every control in page order, the ad ended in format 1:1",
    "WARN  the last Format button check_page clicked was expected to set 9:16, the ad ended in '1:1'. Keep the Format buttons in the order 16:9, 1:1, 9:16 and check the data-format handler, otherwise 9:16 was not verified",
    "      scenes seen over the playback: ['0', '1', '0', '1']",
    "WARN  only scenes ['0', '1'] played in 20 seconds but the brief has 3",
    "      scene to scene change: scene 0 to 1 = 0.28",
    `      screenshots in ${shots_dir}`,
  ]);
});

test("identical scene shots warn, and a page using timeline() gets the scene block without being an ad", () => {
  const identical = check_report(live({ ad_format: "9:16", scenes: ["0", "1", "2"] }), shots([["wide_a", images.noise], ["scene_02_s2", images.scene_a], ["scene_00_s0", images.scene_a], ["scene_01_s1", images.scene_a]]), ad, shots_dir);
  assert.deepEqual(identical.lines.slice(1), [
    "      check_page clicked every control in page order, the ad ended in format 9:16",
    "      scenes seen over the playback: ['0', '1', '2']",
    "      scene to scene change: scene 0 to 1 = 0.00, scene 1 to 2 = 0.00",
    "WARN  the scenes look identical, each scene should change what is on screen (slots, mood, layers)",
    `      screenshots in ${shots_dir}`,
  ]);
  const timeline = check_report(live(), shots([["wide_a", images.noise]]), { ...page, uses_timeline: true }, shots_dir);
  assert.deepEqual(timeline.lines.slice(1, 3), ["      scenes seen over the playback: []", "FAIL  the timeline never left scene 0 during about 20 seconds. Check dur values, the total must be 16 seconds or less, and that timeline() is called"]);
});

test("py_fixed rounds like Python's format, half to even only on exact binary ties", () => {
  const cases: [number, number, string][] = [
    [0.125, 2, "0.12"],
    [0.375, 2, "0.38"],
    [2.5, 0, "2"],
    [3.5, 0, "4"],
    [0.5, 0, "0"],
    [1.25, 1, "1.2"],
    [0.0015, 3, "0.002"],
    [0.0025, 3, "0.003"],
    [1.005, 2, "1.00"],
    [0.045, 2, "0.04"],
    [0.97, 2, "0.97"],
    [0, 3, "0.000"],
    [24.845765027322404, 1, "24.8"],
    [0.27570833333333333, 2, "0.28"],
  ];
  for (const [value, digits, expected] of cases) {
    assert.equal(py_fixed(value, digits), expected, `${value} .${digits}f`);
  }
});

test("py_str matches Python's repr quoting and escapes", () => {
  const cases: [string, string][] = [
    ["9:16", "'9:16'"],
    ["it's", `"it's"`],
    [`a"b'c`, `'a"b\\'c'`],
    ["x\ny", "'x\\ny'"],
    ["\t", "'\\t'"],
    ["\\", "'\\\\'"],
    ["\x00", "'\\x00'"],
    ["\x7f", "'\\x7f'"],
    ["\x85", "'\\x85'"],
    ["\xa0", "'\\xa0'"],
    ["\u200b", "'\\u200b'"],
    ["\u2028", "'\\u2028'"],
    [" ", "' '"],
    ["\u00fc", "'\u00fc'"],
    ["\u{1F600}", "'\u{1F600}'"],
  ];
  for (const [value, expected] of cases) {
    assert.equal(py_str(value), expected, JSON.stringify(value));
  }
});
