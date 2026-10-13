import path from "node:path";
import type { ScriptRole } from "../../shared/review.ts";
import { error_text } from "../storage/coerce.ts";
import { against_location, child_state, resolved, source_depth, type WalkState } from "./command-walk.ts";
import { env_value } from "./launch-targets.ts";
import type { PackageCall } from "./package-calls.ts";
import { is_file } from "./script-loads.ts";
import type { ScriptFile } from "./sources.ts";

export type PackageHost = {
  root: string;
  touch: (file: string, role: ScriptRole, required: boolean) => Promise<ScriptFile | null>;
  gap: (reason: string) => void;
  run: (body: string, depth: number, state: WalkState) => Promise<unknown>;
};

const lifecycle = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare"];

const script_state = (state: WalkState, location: string): WalkState => {
  const child = child_state(state);
  const bin = path.join(location, "node_modules", ".bin");
  const listed = env_value(child, "path");
  child.values.env.set("path", "values" in listed ? resolved(listed.values.map((entry) => (entry ? bin + ";" + entry : bin))) : listed);
  child.location = { current: resolved([location]), stack: [], stack_known: true };
  return child;
};

const manifest_folder = async (location: string, root: string): Promise<string> => {
  for (let folder = location; ; folder = path.dirname(folder)) {
    if (await is_file(path.join(folder, "package.json"))) return folder;
    if (path.resolve(folder) === path.resolve(root) || path.dirname(folder) === folder) return location;
  }
};

export const package_runner = (host: PackageHost) => {
  const manifests = new Map<string, Record<string, string>>();
  const raw = new Map<string, string>();
  const done = new Set<string>();
  const active = new Set<string>();
  const run_manifest = async (call: PackageCall, depth: number, folder: string, state: WalkState): Promise<void> => {
    const manifest_path = path.join(folder, "package.json");
    const manifest = await host.touch(manifest_path, "manifest", !call.lifecycle);
    if (!manifest) return;
    if (!raw.has(manifest.abs)) raw.set(manifest.abs, manifest.text ?? "");
    const selected = manifests.get(manifest.abs) ?? {};
    const parsed = JSON.parse(raw.get(manifest.abs) ?? "") as { scripts?: Record<string, string> };
    const key = manifest_path + ":" + call.name;
    if (!call.lifecycle && typeof parsed.scripts?.[call.name] !== "string") {
      host.gap("Package script is missing: " + call.name);
      return;
    }
    if (active.has(key) || depth >= source_depth) {
      host.gap("Package script recursion limit reached: " + key);
      return;
    }
    if (done.has(key)) return;
    done.add(key);
    active.add(key);
    try {
      const names = call.lifecycle ? lifecycle : ["pre" + call.name, call.name, "post" + call.name];
      for (const entry of call.ignore_scripts ? (call.lifecycle ? [] : [call.name]) : names) {
        const body = parsed.scripts?.[entry];
        if (typeof body !== "string") continue;
        selected[entry] = body;
        manifests.set(manifest.abs, selected);
        manifest.text = JSON.stringify(selected);
        manifest.chars = manifest.text.length;
        await host.run(body, depth + 1, script_state(state, folder));
      }
    } finally {
      active.delete(key);
    }
  };
  return async (call: PackageCall, depth: number, location: string, state: WalkState): Promise<void> => {
    try {
      const prefix = call.prefix ? against_location(call.prefix, resolved([location])) : null;
      if (prefix && "unresolved" in prefix) {
        host.gap("Package folder could not be resolved: " + prefix.unresolved);
        return;
      }
      for (const folder of prefix ? prefix.values : [await manifest_folder(location, host.root)]) await run_manifest(call, depth, folder, state);
    } catch (error) {
      host.gap("Package script inspection failed: " + error_text(error));
    }
  };
};
