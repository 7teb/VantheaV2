const electron = require("electron");
const child_process = require("node:child_process");
const fs = require("node:fs");
const node_module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { app } = electron;
const openrouter = "https://openrouter.ai/";
const fake_base = (process.env.VX_SMOKE_OPENROUTER_URL || "").replace(/\/+$/, "");
const openai_hosts = ["https://auth.openai.com/", "https://api.openai.com/"];
const openai_base = (process.env.VX_SMOKE_OPENAI_URL || "").replace(/\/+$/, "");
const smoke_url = /^http:\/\/127\.0\.0\.1:\d+$/;
const loopback = /^http:\/\/127\.0\.0\.1:\d+\//;
const log_file = process.env.VX_SMOKE_LOG || "";
const real_fetch = globalThis.fetch;
const real_spawn = child_process.spawn;
const fake_claude = process.env.VX_SMOKE_CLAUDE || "";
const smoke_node = process.env.VX_SMOKE_NODE || "";

const fail = (step, error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ vantheax: "error", step, message })}\n`, () => app.exit(1));
};

const tee_output = () => {
  const original_error = process.stderr.write.bind(process.stderr);
  let log_failed = false;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      try {
        fs.appendFileSync(log_file, typeof chunk === "string" ? chunk : Buffer.from(chunk));
      } catch (error) {
        if (!log_failed) {
          log_failed = true;
          original_error(`[smoke-entry] writing the log ${log_file} failed: ${error.message}\n`);
        }
      }
      return write(chunk, ...rest);
    };
  }
};

const openai_target = (url) => {
  const host = openai_base ? openai_hosts.find((prefix) => url.startsWith(prefix)) : undefined;
  return host ? `${openai_base}/${url.slice(host.length)}` : null;
};

const patch_fetch = () => {
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(openrouter)) {
      return real_fetch(`${fake_base}/${url.slice(openrouter.length)}`, init);
    }
    const target = openai_target(url);
    if (target) {
      return real_fetch(target, init);
    }
    return Promise.reject(new Error(`network is disabled in the headless smoke run: ${url.slice(0, 200)}`));
  };
};

const open_mapped = async (url) => {
  const target = openai_target(url);
  if (!target) {
    throw new Error(`opening external pages is disabled in the headless smoke run, refused ${url.split("?")[0].slice(0, 200)}`);
  }
  const authorize = await real_fetch(target, { redirect: "manual" });
  const location = authorize.headers.get("location") || "";
  const answer = await authorize.text();
  if (authorize.status !== 302 || !loopback.test(location)) {
    throw new Error(`the fake authorize endpoint answered HTTP ${authorize.status} without a loopback redirect: ${answer.slice(0, 600)}`);
  }
  const callback = await real_fetch(location, { redirect: "manual" });
  await callback.text();
  if (callback.status !== 200) {
    throw new Error(`the sign-in callback answered HTTP ${callback.status}`);
  }
};

const patch_open_external = () => {
  const replacement = (url) => open_mapped(String(url));
  electron.shell.openExternal = replacement;
  if (electron.shell.openExternal !== replacement) {
    throw new Error("shell.openExternal could not be replaced, so the smoke run would open a real browser");
  }
};

const claude_spawn = (command, args, options) => {
  if (!fake_claude) {
    throw new Error("spawning Claude Code is disabled in the headless smoke run");
  }
  const env = (options && options.env) || process.env;
  process.stderr.write(`${JSON.stringify({ vx_smoke: "claude_spawn", command: path.basename(command), args, entrypoint: env.CLAUDE_CODE_ENTRYPOINT ?? null })}\n`);
  return real_spawn(smoke_node, [fake_claude, ...args], options);
};

const spawn_replacement = function spawn(command, ...rest) {
  if (path.basename(String(command)).toLowerCase() !== "claude.exe") {
    return real_spawn.call(this, command, ...rest);
  }
  const [args, options] = Array.isArray(rest[0]) ? rest : [[], rest[0]];
  return claude_spawn(String(command), args, options);
};

const patch_spawn = async () => {
  child_process.spawn = spawn_replacement;
  node_module.syncBuiltinESMExports();
  const esm = await import("node:child_process");
  if (child_process.spawn !== spawn_replacement || esm.spawn !== spawn_replacement) {
    throw new Error("child_process.spawn could not be replaced, so the smoke run could start the real Claude Code");
  }
};

const start = async () => {
  if (log_file) {
    tee_output();
  }
  patch_fetch();
  if (openai_base) {
    patch_open_external();
  }
  await patch_spawn();
  import(pathToFileURL(path.join(app.getAppPath(), "dist-electron", "main.js")).href).catch((error) => {
    console.error("[smoke-entry] loading dist-electron/main.js failed:", error);
    fail("smoke entry", error);
  });
};

if (!smoke_url.test(fake_base)) {
  fail("smoke entry", new Error(`VX_SMOKE_OPENROUTER_URL must be http://127.0.0.1:<port>, got "${fake_base}"`));
} else if (openai_base && !smoke_url.test(openai_base)) {
  fail("smoke entry", new Error(`VX_SMOKE_OPENAI_URL must be http://127.0.0.1:<port>, got "${openai_base}"`));
} else if (fake_claude && !(path.isAbsolute(fake_claude) && path.isAbsolute(smoke_node))) {
  fail("smoke entry", new Error(`VX_SMOKE_CLAUDE and VX_SMOKE_NODE must be absolute paths, got "${fake_claude}" and "${smoke_node}"`));
} else {
  start().catch((error) => {
    console.error("[smoke-entry] preparing the smoke run failed:", error);
    fail("smoke entry", error);
  });
}
