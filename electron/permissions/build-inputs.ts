import path from "node:path";
import { is_inside } from "../project/scope.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { is_file, type Loads } from "./script-loads.ts";
import type { Dialect } from "./statements.ts";

export type InputRef = { written: string; values: string[] };

const description_extension = /\.(?:sln|slnx|\w*proj|props|targets|cmake|mk)$/i;

const description_name = /^(?:CMakeLists\.txt|Makefile|makefile|GNUmakefile|build\.ninja|meson\.build)$/;

const project_file = /\.\w*proj$/i;

const failure = (error: unknown): string => error_code(error) || error_text(error);

export const build_description = (file: string): boolean => description_extension.test(file) || description_name.test(path.win32.basename(file));

export const input_values = (values: string[], quoted: boolean, dialect: Dialect): string[] =>
  values.flatMap((value) => {
    if (value.startsWith("@")) return value.length > 1 && (quoted || dialect === "cmd" || dialect === "posix") ? [value.slice(1)] : [];
    return build_description(value) ? [value] : [];
  });

const literal_paths = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map((match) => match[1] ?? "").filter((entry) => entry && !entry.includes("$(") && !/[*?]/.test(entry));

const referenced = (text: string, file: string): string[] => {
  if (/\.sln$/i.test(file)) return [...text.matchAll(/^\s*Project\("[^"]*"\)\s*=\s*"[^"]*"\s*,\s*"([^"]+)"/gm)].map((match) => match[1] ?? "").filter(build_description);
  if (/\.slnx$/i.test(file)) return literal_paths(text, /<Project\s[^>]*?\bPath\s*=\s*"([^"]+)"/gi);
  return [...literal_paths(text, /<Import\s[^>]*?\bProject\s*=\s*"([^"]+)"/gi), ...literal_paths(text, /<ProjectReference\s[^>]*?\bInclude\s*=\s*"([^"]+)"/gi)];
};

const nearest_directory_build = async (file: string, root: string, gaps: string[]): Promise<string[]> => {
  const found: string[] = [];
  for (const name of ["Directory.Build.props", "Directory.Build.targets"]) {
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, name);
      try {
        if (await is_file(candidate)) {
          found.push(candidate);
          break;
        }
      } catch (error) {
        gaps.push(`Build import could not be checked: ${candidate} (${failure(error)}).`);
        break;
      }
      if (!root || dir === root || !is_inside(root, path.dirname(dir)) || path.dirname(dir) === dir) break;
    }
  }
  return found;
};

export const build_references = async (text: string, file: string, root: string): Promise<Loads> => {
  const gaps: string[] = [];
  const here = path.dirname(file);
  const files: string[] = [];
  for (const entry of referenced(text, file)) {
    const target = path.resolve(here, entry);
    try {
      if (await is_file(target)) files.push(target);
    } catch (error) {
      gaps.push(`Build import could not be checked: ${entry} in ${file} (${failure(error)}).`);
    }
  }
  if (project_file.test(file)) files.push(...(await nearest_directory_build(file, root, gaps)));
  return { files: [...new Set(files)], gaps };
};
