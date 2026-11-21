import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { parse_launch } from "../electron/app/headless-args.ts";

const app_data = "C:\\Users\\Tester\\AppData\\Roaming";

const token = "t".repeat(32);

const switches = (values: Record<string, string>) => ({
  has: (name: string) => Object.hasOwn(values, name),
  value: (name: string) => values[name] ?? "",
});

const as_given = (target: string) => target;

const launch = (values: Record<string, string>, env: Record<string, string | undefined> = { VANTHEAX_API_TOKEN: token }, resolve_real = as_given) =>
  parse_launch(switches(values), env, app_data, resolve_real);

const error_of = (values: Record<string, string>, env?: Record<string, string | undefined>, resolve_real = as_given) => {
  const result = launch(values, env, resolve_real);
  assert.equal(result.kind, "error", JSON.stringify(result));
  return result.kind === "error" ? result.message : "";
};

test("a start without --vx-serve is the desktop app, whatever else is passed", () => {
  assert.deepEqual(launch({}), { kind: "gui" });
  assert.deepEqual(launch({ "vx-port": "abc", "vx-lease": "file" }, {}), { kind: "gui" });
});

test("--vx-serve alone uses port 0, the default data dir, no lease and an empty OpenRouter key", () => {
  assert.deepEqual(launch({ "vx-serve": "" }), {
    kind: "headless",
    config: { port: 0, data_dir: path.join(app_data, "VantheaX-headless"), app_dir: path.join(app_data, "VantheaX"), lease_stdin: false, token, openrouter_key: "" },
  });
});

test("explicit switches and the OpenRouter key reach the config", () => {
  const result = launch({ "vx-serve": "", "vx-port": "8123", "vx-data-dir": "D:\\runs\\one\\", "vx-lease": "stdin" }, { VANTHEAX_API_TOKEN: token, OPENROUTER_API_KEY: "sk-or-test" });
  assert.deepEqual(result, {
    kind: "headless",
    config: { port: 8123, data_dir: "D:\\runs\\one", app_dir: path.join(app_data, "VantheaX"), lease_stdin: true, token, openrouter_key: "sk-or-test" },
  });
});

test("a data dir that reaches the desktop app's data folder through a junction or a short name is refused", () => {
  const app_dir = path.join(app_data, "VantheaX");
  const links: Record<string, string> = {
    "d:\\links\\vx": app_dir,
    "c:\\users\\tester~1\\appdata\\roaming\\vanthe~1\\v2": path.join(app_dir, "v2"),
  };
  const resolve_real = (target: string) => links[target.toLowerCase()] ?? target;
  for (const dir of Object.keys(links)) {
    assert.match(error_of({ "vx-serve": "", "vx-data-dir": dir }, undefined, resolve_real), /must not be the VantheaX app data folder/, dir);
  }
  const resolved = launch({ "vx-serve": "", "vx-data-dir": "D:\\elsewhere" }, undefined, (target) => (target === "D:\\elsewhere" ? "E:\\real\\elsewhere" : target));
  assert.equal(resolved.kind === "headless" && resolved.config.data_dir, "E:\\real\\elsewhere");
});

test("a data dir that cannot be resolved is refused with the resolver's error", () => {
  const failing = () => {
    throw new Error("EACCES: access denied");
  };
  assert.match(error_of({ "vx-serve": "", "vx-data-dir": "D:\\locked" }, undefined, failing), /cannot be resolved: EACCES: access denied/);
});

test("ports 0 and 65535 are valid, anything else outside integers 0..65535 is refused", () => {
  for (const port of ["0", "65535"]) {
    const result = launch({ "vx-serve": "", "vx-port": port });
    assert.equal(result.kind === "headless" && result.config.port, Number(port));
  }
  for (const port of ["", "abc", "-1", "65536", "1.5", "123456", "+80", " 80"]) {
    assert.match(error_of({ "vx-serve": "", "vx-port": port }), /--vx-port/, port);
  }
});

test("a relative or empty data dir is refused", () => {
  for (const dir of ["", "data", "runs\\one", "C:relative"]) {
    assert.match(error_of({ "vx-serve": "", "vx-data-dir": dir }), /--vx-data-dir must be an absolute path/, dir);
  }
});

test("the desktop app's data folder, any folder inside it and any folder containing it are refused in any case and spelling", () => {
  const refused = [
    "C:\\Users\\Tester\\AppData\\Roaming\\VantheaX",
    "c:\\users\\tester\\appdata\\roaming\\VANTHEAX\\",
    "C:/Users/Tester/AppData/Roaming/vantheax",
    "C:\\Users\\Tester\\AppData\\Roaming\\VantheaX\\v2",
    "C:\\USERS\\tester\\AppData\\Roaming\\Vantheax\\headless\\run",
    "C:\\Users\\Tester\\AppData\\Roaming\\VantheaX\\..\\VantheaX\\v2",
    "C:\\Users\\Tester\\AppData\\Roaming",
    "c:\\users\\tester",
    "C:\\",
  ];
  for (const dir of refused) {
    assert.match(error_of({ "vx-serve": "", "vx-data-dir": dir }), /--vx-data-dir .* must not be the VantheaX app data folder/, dir);
  }
});

test("sibling folders next to the desktop app's data folder are accepted", () => {
  for (const dir of ["C:\\Users\\Tester\\AppData\\Roaming\\VantheaX-headless", "C:\\Users\\Tester\\AppData\\Roaming\\VantheaX2", "D:\\VantheaX"]) {
    const result = launch({ "vx-serve": "", "vx-data-dir": dir });
    assert.equal(result.kind, "headless", dir);
  }
});

test("--vx-lease only accepts stdin", () => {
  for (const lease of ["", "file", "STDIN", "stdin "]) {
    assert.match(error_of({ "vx-serve": "", "vx-lease": lease }), /--vx-lease only accepts "stdin"/, lease);
  }
});

test("the API token is required and needs at least 32 characters, and it is never echoed", () => {
  assert.match(error_of({ "vx-serve": "" }, {}), /VANTHEAX_API_TOKEN must be set/);
  assert.match(error_of({ "vx-serve": "" }, { VANTHEAX_API_TOKEN: "" }), /VANTHEAX_API_TOKEN must be set/);
  const short = "s".repeat(31);
  const message = error_of({ "vx-serve": "" }, { VANTHEAX_API_TOKEN: short });
  assert.match(message, /VANTHEAX_API_TOKEN must be at least 32 characters/);
  assert.equal(message.includes(short), false);
});
