import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { error_text } from "../storage/coerce.ts";
import { detect_encoding, read_head } from "../storage/text-codec.ts";
import { is_inside } from "./scope.ts";

export type Utf16Encoding = "utf-16le" | "utf-16be";

export type EncodingFiles = { groups: Record<Utf16Encoding, string[]>; error: string | null };

const nul_files = (binary: string, filters: string[], root: string, target: string, signal: AbortSignal): Promise<{ files: string[]; error: string | null }> =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const args = [...filters, "--files-with-matches", "--null", "--text", "--encoding", "none", "--regexp", "\\x00", "--", target];
    const child = spawn(binary, args, { cwd: root, windowsHide: true });
    const files: string[] = [];
    let pending = "";
    let stderr = "";
    let settled = false;
    const finish = (error: unknown, scan_error: string | null = null) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", on_abort);
      if (error) {
        reject(error);
        return;
      }
      resolve({ files, error: scan_error });
    };
    const on_abort = () => { child.kill(); };
    signal.addEventListener("abort", on_abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const parts = (pending + chunk).split("\0");
      pending = parts.pop() ?? "";
      files.push(...parts);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish(new Error(`ripgrep encoding scan could not start: ${error_text(error)}`)));
    child.on("close", (code) => {
      if (signal.aborted) {
        finish(signal.reason);
        return;
      }
      finish(null, code === 0 || code === 1 ? null : stderr.trim() || `ripgrep encoding scan exited with code ${code}`);
    });
  });

export const find_utf16_files = async (binary: string, filters: string[], root: string, target: string, file: boolean, hidden: (relative: string) => boolean, signal: AbortSignal, candidates?: string[]): Promise<EncodingFiles> => {
  const scan = candidates ? { files: candidates, error: null } : file ? { files: [target], error: null } : await nul_files(binary, filters, root, target, signal);
  const result: EncodingFiles = { groups: { "utf-16le": [], "utf-16be": [] }, error: scan.error };
  const seen = new Set<string>();
  const inspect = async (candidate: string) => {
    signal.throwIfAborted();
    const absolute = path.resolve(root, candidate);
    if (!is_inside(root, absolute) || hidden(path.relative(root, absolute))) {
      return;
    }
    try {
      const real = await fs.realpath(absolute);
      if (!is_inside(root, real) || hidden(path.relative(root, real)) || seen.has(real)) {
        return;
      }
      seen.add(real);
      const encoding = detect_encoding(await read_head(real));
      if (!encoding.bom && encoding.charset !== "utf8") {
        result.groups[encoding.charset === "utf16le" ? "utf-16le" : "utf-16be"].push(real);
      }
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      const detail = `${absolute}: ${error_text(error)}`;
      result.error = result.error ? `${result.error}\n${detail}` : detail;
    }
  };
  for (let index = 0; index < scan.files.length; index += 2) {
    await Promise.all(scan.files.slice(index, index + 2).map(inspect));
  }
  return result;
};

export const encoding_batches = (files: string[], reserved_chars = 0): string[][] => {
  const batches: string[][] = [];
  let batch: string[] = [];
  let chars = 0;
  const budget = Math.max(1, 20_000 - reserved_chars * 2);
  for (const file of files) {
    const cost = file.length * 2 + 4;
    if (batch.length && chars + cost > budget) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(file);
    chars += cost;
  }
  if (batch.length) {
    batches.push(batch);
  }
  return batches;
};
