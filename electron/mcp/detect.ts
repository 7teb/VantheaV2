import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { McpServerConfig } from "../../shared/settings.ts";
import { sanitize_server_name } from "./specs.ts";

export type Detection = { ok: boolean; name: string; config: McpServerConfig; source: "readme" | "python" | "node" | "none"; note: string };

type Launch = { name: string; command: string; args: string[]; env: Record<string, string> };

const skipped_dirs = new Set(["node_modules", ".git", "__pycache__", "dist", "build", ".idea", ".vs", ".vscode", "target", ".mypy_cache", ".pytest_cache", ".tox"]);

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

const collect_files = async (root: string, max_files = 4000, max_depth = 5) => {
  const files: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > max_depth || files.length >= max_files) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      console.warn(`[mcp] detect: reading ${dir} failed: ${error_text(error)}`);
      return;
    }
    for (const entry of entries) {
      if (files.length >= max_files) {
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !skipped_dirs.has(entry.name.toLowerCase())) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  await walk(root, 0);
  return files;
};

export const balanced_json = (text: string, start: number): string | null => {
  let depth = 0;
  let in_string = false;
  let escaped = false;
  for (let index = start; index < text.length && index - start <= 20000; index += 1) {
    const char = text[index];
    if (in_string) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        in_string = false;
      }
      continue;
    }
    if (char === '"') {
      in_string = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
};

const string_map = (value: unknown): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)])) : {};

const launch_from = (name: string, entry: unknown): Launch | null => {
  const source = entry as { command?: unknown; args?: unknown; env?: unknown } | null;
  if (!source || typeof source !== "object" || !source.command) {
    return null;
  }
  return { name, command: String(source.command), args: Array.isArray(source.args) ? source.args.map(String) : [], env: string_map(source.env) };
};

export const launch_from_config = (value: unknown): Launch | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const object = value as Record<string, unknown>;
  if (object.mcpServers && typeof object.mcpServers === "object") {
    const [first] = Object.entries(object.mcpServers as Record<string, unknown>);
    return first ? launch_from(first[0], first[1]) : null;
  }
  if (object.command) {
    return launch_from("", object);
  }
  const keys = Object.keys(object);
  return keys.length === 1 ? launch_from(keys[0], object[keys[0]]) : null;
};

const json_candidates = (text: string) => {
  const candidates = [...text.matchAll(/```[a-zA-Z0-9]*\s*\n([\s\S]*?)```/g)].map((match) => match[1]);
  for (const anchor of ['"mcpServers"', '"command"']) {
    for (let index = text.indexOf(anchor); index !== -1; index = text.indexOf(anchor, index + anchor.length)) {
      for (let start = text.lastIndexOf("{", index); start !== -1; start = text.lastIndexOf("{", start - 1)) {
        const slice = balanced_json(text, start);
        if (slice && start + slice.length > index) {
          candidates.push(slice);
          break;
        }
      }
    }
  }
  return candidates;
};

export const launch_from_readme = (text: string): Launch | null => {
  for (const candidate of json_candidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.trim());
    } catch (error) {
      console.warn(`[mcp] detect: readme snippet is not JSON (${error_text(error)})`);
      continue;
    }
    const launch = launch_from_config(parsed);
    if (launch) {
      return launch;
    }
  }
  return null;
};

const resolve_paths = (launch: Launch, files: string[]): Launch => {
  const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  const known = new Set(files.map(normalize));
  const by_base = new Map<string, string>();
  for (const file of files) {
    const base = path.basename(file).toLowerCase();
    if (!by_base.has(base)) {
      by_base.set(base, file);
    }
  }
  const fix = (value: string) => {
    const looks_like_path = /[\\/]/.test(value) || /\.(py|pyw|js|mjs|cjs|ts|exe|jar|sh|bat|cmd)$/i.test(value);
    if (!looks_like_path || known.has(normalize(value))) {
      return value;
    }
    return by_base.get(path.basename(normalize(value))) ?? value;
  };
  return { ...launch, command: fix(launch.command), args: launch.args.map(fix) };
};

type FileMeta = { file: string; base: string; relative: string };

const python_score = (meta: FileMeta) => {
  if (!meta.base.endsWith(".py")) {
    return -100;
  }
  const rules: [boolean, number][] = [
    [meta.base.startsWith("mcp"), 5],
    [meta.base.includes("server"), 4],
    [meta.base === "__main__.py", 3],
    [meta.base === "main.py", 2],
    [meta.relative.includes("mcp"), 2],
    [meta.relative.includes("server"), 1],
    [meta.relative.includes("test"), -5],
    [meta.relative.includes("example"), -4],
    [meta.base === "setup.py" || meta.base === "conftest.py", -8],
  ];
  return rules.reduce((score, [hit, weight]) => (hit ? score + weight : score), 0);
};

const node_entry = async (package_file: string) => {
  try {
    const parsed = JSON.parse(await readFile(package_file, "utf8")) as { name?: unknown; bin?: unknown; main?: unknown };
    const bin = typeof parsed.bin === "string" ? parsed.bin : parsed.bin && typeof parsed.bin === "object" ? Object.values(parsed.bin)[0] : null;
    const entry = typeof bin === "string" ? bin : typeof parsed.main === "string" ? parsed.main : null;
    return entry ? { name: typeof parsed.name === "string" ? (parsed.name.split("/").pop() ?? "") : "", entry: path.resolve(path.dirname(package_file), entry) } : null;
  } catch (error) {
    console.warn(`[mcp] detect: reading ${package_file} failed: ${error_text(error)}`);
    return null;
  }
};

const heuristic_launch = async (root: string, files: string[]): Promise<(Launch & { source: Detection["source"]; note: string }) | null> => {
  const metas: FileMeta[] = files.map((file) => ({ file, base: path.basename(file).toLowerCase(), relative: path.relative(root, file).replace(/\\/g, "/").toLowerCase() }));
  const venv = metas.find((meta) => /(^|\/)(\.venv|venv|env)\/scripts\/python\.exe$/i.test(meta.relative));
  const best = metas.reduce<FileMeta | null>((winner, meta) => (python_score(meta) > (winner ? python_score(winner) : 0) ? meta : winner), null);
  if (best) {
    const note = venv ? "Python entry detected, using the folder's venv." : "Python entry detected. If it fails to start, set the command to the full path of your python.exe.";
    return { name: "", command: venv ? venv.file : "python", args: [best.file], env: {}, source: "python", note };
  }
  const package_meta = metas.find((meta) => meta.base === "package.json" && meta.relative.split("/").length <= 2);
  const node = package_meta ? await node_entry(package_meta.file) : null;
  return node ? { name: node.name, command: "node", args: [node.entry], env: {}, source: "node", note: "Node entry detected from package.json." } : null;
};

const config_for = (launch: Launch, root: string): McpServerConfig => ({ command: launch.command, args: launch.args, cwd: root, env: launch.env, enabled: true });

const read_readme = async (root: string, files: string[]) => {
  const readme = files.find((file) => {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    return relative.split("/").length <= 2 && /(^|\/)readme(\.(md|txt|rst))?$/i.test(relative);
  });
  if (!readme) {
    return null;
  }
  try {
    return (await readFile(readme, "utf8")).slice(0, 200000);
  } catch (error) {
    console.warn(`[mcp] detect: reading ${readme} failed: ${error_text(error)}`);
    return null;
  }
};

export const detect_server = async (folder: string): Promise<Detection> => {
  const root = path.resolve(folder);
  const empty = (name: string, note: string): Detection => ({ ok: false, name, config: config_for({ name, command: "", args: [], env: {} }, root), source: "none", note });
  const info = await stat(root).catch((error: unknown) => {
    console.warn(`[mcp] detect: ${root} is not accessible: ${error_text(error)}`);
    return null;
  });
  if (!info?.isDirectory()) {
    return empty("", info ? "That path is a file, not a folder." : "Folder not found.");
  }
  const folder_name = path.basename(root);
  const base_name = sanitize_server_name(folder_name.replace(/[-_]?mcp([-_](bridge|server))?$/i, "")) || sanitize_server_name(folder_name) || "server";
  const files = await collect_files(root);
  const readme = await read_readme(root, files);
  const from_readme = readme ? launch_from_readme(readme) : null;
  const detected = from_readme ? { ...resolve_paths(from_readme, files), source: "readme" as const, note: "Config taken from the server's README." } : await heuristic_launch(root, files);
  if (!detected) {
    return empty(base_name, "Could not detect the launch command. Paste the server's config from its README or enter the command and arguments.");
  }
  const command = process.platform === "win32" && /^python3$/i.test(detected.command) ? "python" : detected.command;
  const python_hint = process.platform === "win32" && /^python$/i.test(command) ? ' If Windows cannot find "python", set the command to the full path of your python.exe.' : "";
  return {
    ok: true,
    name: sanitize_server_name(detected.name) || base_name,
    config: config_for({ ...detected, command }, root),
    source: detected.source,
    note: `${detected.note}${python_hint}`,
  };
};
