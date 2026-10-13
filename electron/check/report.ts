import type { PageFacts } from "./facts.ts";
import { analyze, motion } from "./measure.ts";
import type { RgbImage } from "./png.ts";
import { py_fixed, py_str } from "./py-format.ts";

export type Layout = { stage: [number, number] | null; horizontal_overflow: boolean; zero_size_canvases: number };

export type LiveData = {
  errors: string[];
  blocked: string[];
  interactions: number;
  layout: Layout | null;
  narrow_overflow: boolean;
  phone_overflow: boolean;
  scenes: string[] | null;
  ad_format: string | null;
};

export type CheckReport = { lines: string[]; fails: number; warns: number };

const format_warning = (format: string | null) =>
  `the last Format button check_page clicked was expected to set 9:16, the ad ended in ${format === null ? "None" : py_str(format)}. Keep the Format buttons in the order 16:9, 1:1, 9:16 and check the data-format handler, otherwise 9:16 was not verified`;

const py_list = (values: string[]) => `[${values.map(py_str).join(", ")}]`;

const stage_text = (stage: [number, number] | null) => (stage ? `[${stage[0]}, ${stage[1]}]` : "None");

const scene_name = (key: string) => key.split("_s").pop() ?? "";

export const check_report = (data: LiveData, shots: Map<string, RgbImage>, facts: PageFacts, shots_dir: string): CheckReport => {
  const lines: string[] = [];
  let fails = 0;
  let warns = 0;
  const report = (level: "FAIL" | "WARN", message: string) => {
    lines.push(`${level}  ${message}`);
    fails += level === "FAIL" ? 1 : 0;
    warns += level === "WARN" ? 1 : 0;
  };
  const print = (message: string) => lines.push(`      ${message}`);
  const result = () => ({ lines, fails, warns });

  for (const error of data.errors.slice(0, 6)) {
    report("FAIL", `runtime: ${error}`);
  }
  for (const url of data.blocked.slice(0, 6)) {
    report("WARN", `blocked a request to ${url}, check_page allows only Google Fonts`);
  }
  if (data.interactions < 2) {
    report("WARN", "fewer than 2 controls or stage interactions were found, are the controls inside .controls?");
  }
  const layout = data.layout;
  if (layout?.zero_size_canvases) {
    report("FAIL", `${layout.zero_size_canvases} canvas has zero size, the stage will be blank`);
  }
  if (layout?.horizontal_overflow) {
    report("FAIL", "page scrolls sideways at 1440 wide");
  }
  if (data.narrow_overflow) {
    report("FAIL", "page scrolls sideways at 800 wide");
  }
  if (data.phone_overflow) {
    report("WARN", "page scrolls sideways at 390 wide (phone)");
  }
  const stage = layout?.stage ?? null;
  if (stage && !facts.is_ad && (stage[1] < 300 || stage[0] < 500)) {
    report("WARN", `stage is only ${stage[0]}x${stage[1]}, too small to show anything`);
  }

  const wide_a = shots.get("wide_a");
  if (!wide_a) {
    report("FAIL", "the live check produced no screenshots");
    return result();
  }
  const first = analyze(wide_a);
  print(`stats modal=${py_fixed(first.modal, 2)} colors=${first.colors} edges=${py_fixed(first.edges, 1)} interactions=${data.interactions} stage after the controls were used=${stage_text(stage)}`);
  if (first.modal > 0.97) {
    report("FAIL", "screenshot is almost one flat color, the page looks blank");
  }
  if (first.colors < 14) {
    report("WARN", `only ${first.colors} distinct colors, looks flat`);
  }
  const still = shots.get("wide_still");
  if (still) {
    const idle = motion(wide_a, still);
    print(`idle motion changed_pixels=${py_fixed(idle, 3)} (no pointer, 1.5s apart)`);
    if (idle < 0.0015) {
      report("WARN", "nothing moves on its own when the pointer is away, add idle motion from time");
    }
    const pointer = shots.get("wide_b");
    if (pointer) {
      print(`pointer reaction changed_pixels=${py_fixed(motion(still, pointer), 3)}`);
    }
  }
  const narrow = shots.get("narrow");
  if (narrow && analyze(narrow).modal > 0.97) {
    report("FAIL", "800px wide screenshot is blank");
  }

  if (facts.is_ad) {
    print(`check_page clicked every control in page order, the ad ended in format ${data.ad_format ?? "None"}`);
    if (data.ad_format !== "9:16") {
      report("WARN", format_warning(data.ad_format));
    }
  }
  const scenes = data.scenes ?? [];
  if (scenes.length || facts.is_ad || facts.uses_timeline) {
    print(`scenes seen over the playback: ${py_list(scenes)}`);
    const distinct = [...new Set(scenes)].sort();
    if (scenes.length < 2) {
      report("FAIL", "the timeline never left scene 0 during about 20 seconds. Check dur values, the total must be 16 seconds or less, and that timeline() is called");
    } else if (facts.brief_scenes && distinct.length < facts.brief_scenes) {
      report("WARN", `only scenes ${py_list(distinct)} played in 20 seconds but the brief has ${facts.brief_scenes}`);
    }
    const scene_shots = [...shots].filter(([key]) => key.startsWith("scene_")).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    if (scene_shots.length >= 2) {
      const diffs = scene_shots.slice(1).map(([, image], at) => motion(scene_shots[at][1], image));
      const names = scene_shots.map(([key]) => scene_name(key));
      print(`scene to scene change: ${diffs.map((diff, at) => `scene ${names[at]} to ${names[at + 1]} = ${py_fixed(diff, 2)}`).join(", ")}`);
      if (Math.max(...diffs) < 0.01) {
        report("WARN", "the scenes look identical, each scene should change what is on screen (slots, mood, layers)");
      }
    }
  }
  print(`screenshots in ${shots_dir}`);
  return result();
};

export const result_line = (report: CheckReport): string =>
  `result: ${report.fails ? "FAIL" : "PASS"}  (${report.fails} fail, ${report.warns} warn). Browser check only; check.py does the source lint.`;
