import { agent_option_keys } from "./protocol.ts";

export const prelude_source = String.raw`(() => {
  "use strict";
  const host = globalThis.__vx_host;
  delete globalThis.__vx_host;
  const stringify = JSON.stringify;
  const RealDate = Date;
  const clock_error = (what) => new Error(what + " reads the clock, which makes the workflow non-deterministic and breaks resume. Pass timestamps in through args.");
  function SafeDate(...values) {
    if (!new.target) throw clock_error("Date()");
    if (values.length === 0) throw clock_error("new Date() without arguments");
    return Reflect.construct(RealDate, values, new.target);
  }
  SafeDate.prototype = RealDate.prototype;
  SafeDate.UTC = RealDate.UTC;
  SafeDate.parse = RealDate.parse;
  SafeDate.now = () => { throw clock_error("Date.now()"); };
  Object.defineProperty(RealDate.prototype, "constructor", { value: SafeDate, writable: true, configurable: true, enumerable: false });
  globalThis.Date = SafeDate;
  Math.random = () => { throw new Error("Math.random() makes the workflow non-deterministic and breaks resume. Vary prompts or labels by index instead."); };
  const to_json = (value) => {
    const text = stringify(value);
    return text === undefined ? "null" : text;
  };
  const attempt = (read, fallback) => {
    try { return read(); } catch (error) { return fallback; }
  };
  const show = (value) => {
    if (typeof value === "string") return value;
    return attempt(() => to_json(value), null) ?? attempt(() => String(value), "(a value that converts neither to JSON nor to a string)");
  };
  const describe_error = (error) => {
    if (error instanceof Error) {
      const head = error.name + ": " + error.message;
      const stack = String(error.stack || "").split("\n").filter((line) => line.trim() && !line.includes("prelude.js") && !line.includes("(native)")).join("\n");
      return stack ? head + "\n" + stack : head;
    }
    return "thrown value " + show(error);
  };
  const describe = (error) => attempt(() => describe_error(error), "a thrown value that cannot be described (reading its name, message or text threw)");
  const call_host = (kind, payload, scope = null) => {
    const answer = host(kind, to_json(payload), scope);
    if (typeof answer === "string") throw new TypeError(answer);
    return answer;
  };
  const pending = new Map();
  const request = (kind, payload, scope) => {
    const id = call_host(kind, payload, scope);
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); });
  };
  const note = (kind, payload) => { call_host(kind, payload); };
  const agent_keys = ${JSON.stringify(agent_option_keys)};
  const is_object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const check_opts = (opts) => {
    if (opts === undefined || opts === null) return {};
    if (!is_object(opts)) throw new TypeError("agent(prompt, opts): opts must be an object");
    const copy = Object.assign({}, opts);
    const unknown = Object.keys(copy).filter((key) => !agent_keys.includes(key));
    if (unknown.length) throw new TypeError("agent(): unknown option " + unknown.join(", ") + "; the options are " + agent_keys.join(", "));
    for (const key of ["label", "phase", "model", "effort"]) {
      if (copy[key] !== undefined && typeof copy[key] !== "string") throw new TypeError("agent(): opts." + key + " must be a string");
    }
    if (typeof copy.phase === "string" && !copy.phase.trim()) throw new TypeError("agent(): opts.phase must be a non-empty string");
    if (copy.schema !== undefined && !is_object(copy.schema)) throw new TypeError("agent(): opts.schema must be a JSON Schema object");
    if (copy.role !== undefined && typeof copy.role !== "string" && !is_object(copy.role)) throw new TypeError("agent(): opts.role must be a role name or a role object");
    if (copy.isolation !== undefined && copy.isolation !== "worktree") throw new TypeError("agent(): opts.isolation can only be 'worktree'");
    return copy;
  };
  const settle_one = async (entry, where, index) => {
    try {
      if (typeof entry === "function") return await entry();
      if (entry !== null && typeof entry === "object" && typeof entry.then === "function") return await entry;
      throw new TypeError("it is not a function or a promise");
    } catch (error) {
      note("caught", { __proto__: null, where, text: where + " item " + index + ": " + describe(error) });
      return null;
    }
  };
  const scope = (child, call) => {
    let current = null;
    const group = (title) => {
      if (child === null) return title;
      return title === null ? "▸ " + child : "▸ " + child + ": " + title;
    };
    const agent = (prompt, opts) => {
      if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("agent(prompt, opts): prompt must be a non-empty string");
      const checked = check_opts(opts);
      const own = checked.phase !== undefined ? checked.phase : current;
      return request("agent", { __proto__: null, prompt, opts: Object.assign({}, checked, { phase: group(own) }) }, call);
    };
    const phase = (title) => {
      if (typeof title !== "string" || !title.trim()) throw new TypeError("phase(title): title must be a non-empty string");
      current = title;
      note("phase", { __proto__: null, title: group(title) });
    };
    const log = (...parts) => { note("log", { __proto__: null, text: parts.map(show).join(" ") }); };
    const parallel = (thunks) => {
      if (!Array.isArray(thunks)) return Promise.reject(new TypeError("parallel(thunks) takes an array of functions"));
      return Promise.all(thunks.map((thunk, index) => settle_one(thunk, "parallel", index)));
    };
    const pipeline = (items, ...stages) => {
      if (!Array.isArray(items)) return Promise.reject(new TypeError("pipeline(items, ...stages) takes an array of items"));
      const bad = stages.findIndex((stage) => typeof stage !== "function");
      if (bad >= 0) return Promise.reject(new TypeError("pipeline(): stage " + (bad + 1) + " is not a function"));
      return Promise.all(items.map(async (item, index) => {
        let prev = item;
        for (let at = 0; at < stages.length; at += 1) {
          try {
            prev = await stages[at](prev, item, index);
          } catch (error) {
            note("caught", { __proto__: null, where: "pipeline", text: "pipeline item " + index + ", stage " + (at + 1) + ": " + describe(error) });
            return null;
          }
        }
        return prev;
      }));
    };
    const workflow = child !== null
      ? () => { throw new Error("workflow() cannot be called inside a child workflow: nesting is one level deep"); }
      : (ref, args) => {
          let target = null;
          if (typeof ref === "string" && ref.trim()) target = { name: ref.trim() };
          else if (is_object(ref) && typeof (ref.script_path ?? ref.scriptPath) === "string") target = { script_path: ref.script_path ?? ref.scriptPath };
          if (target === null) throw new TypeError("workflow(ref, args): ref must be a saved workflow name or { script_path }");
          return request("workflow", { __proto__: null, ref: target, args: args === undefined ? null : args, has_args: args !== undefined });
        };
    return { agent, parallel, pipeline, phase, log, workflow };
  };
  const run = (fn, args_text, child, call) => {
    const hooks = scope(child, call);
    const args = args_text === "" ? undefined : JSON.parse(args_text);
    return fn(hooks.agent, hooks.parallel, hooks.pipeline, hooks.phase, hooks.log, args, hooks.workflow);
  };
  const begin = (fn, args_text, child, call) => {
    try {
      return Promise.resolve(run(fn, args_text, child, call));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  return {
    settle: (id, ok, text) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(JSON.parse(text));
      else entry.reject(new Error(text));
    },
    start: (fn, args_text) => {
      begin(fn, args_text, null, null).then(
        (value) => {
          let text;
          try {
            text = to_json(value);
          } catch (error) {
            note("failed", { __proto__: null, message: "the return value cannot be converted to JSON: " + describe(error) });
            return;
          }
          note("done", { __proto__: null, value_json: text });
        },
        (error) => note("failed", { __proto__: null, message: describe(error) }),
      );
    },
    child: (id, fn, args_text, name) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      begin(fn, args_text, name, id).then(entry.resolve, entry.reject);
    },
  };
})()`;
