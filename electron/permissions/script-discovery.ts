import path from "node:path";
import { error_code, error_text } from "../storage/coerce.ts";
import { expand_entry, is_file, type Loads } from "./script-loads.ts";
import type { Discovery } from "./step-refs.ts";

const test_files: Record<NonNullable<Discovery["runner"]>, RegExp> = {
  pytest: /(?:^|[\\/])(?:test_[^\\/]*|[^\\/]*_test|conftest)\.py$/i,
  unittest: /(?:^|[\\/])test[^\\/]*\.py$/i,
  node: /(?:^|[\\/])(?:[^\\/]*[.\-_]test|test-[^\\/]*|test)\.[cm]?[jt]sx?$|[\\/]test[\\/][^\\/]*\.[cm]?[jt]sx?$/i,
};

export const test_runner = (spec: string): Discovery["runner"] => (spec === "pytest" || spec === "unittest" ? spec : null);

export const runner_file = (file: string, runner: Discovery["runner"]): boolean => runner === null || test_files[runner].test(file);

export const test_sources = async (runner: Discovery["runner"], paths: string[], location: string): Promise<Loads> => {
  if (runner === null || runner === "node" || !paths.length) return { files: [], gaps: [] };
  const files: string[] = [];
  const gaps: string[] = [];
  for (const entry of [...paths, "conftest.py"]) {
    const expanded = await expand_entry(entry.split("::")[0] ?? entry, location, test_files[runner]);
    if (expanded) {
      gaps.push(...expanded.gaps);
      files.push(...expanded.files);
      continue;
    }
    const file = path.resolve(location, entry.split("::")[0] ?? entry);
    try {
      if (await is_file(file)) files.push(file);
    } catch (error) {
      gaps.push(`Test source could not be read: ${file} (${error_code(error) || error_text(error)}).`);
    }
  }
  return { files, gaps };
};
