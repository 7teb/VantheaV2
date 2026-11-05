import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const files = new Map<string, Promise<string>>();

let directory: Promise<string> | null = null;

const config_dir = (): Promise<string> => {
  directory ??= fsp.mkdtemp(path.join(os.tmpdir(), "vantheax-git-filters-")).then((dir) => {
    process.once("exit", () => {
      for (const file of files.keys()) {
        try {
          fs.unlinkSync(path.join(dir, file + ".gitconfig"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            console.warn(`[git] removing filter config ${file} failed:`, error);
          }
        }
      }
      try {
        fs.rmdirSync(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`[git] removing filter config folder ${dir} failed:`, error);
        }
      }
    });
    return dir;
  });
  return directory;
};

export const filter_config = (names: string[]): Promise<string> => {
  const text = [...names].sort().map((name) => `[filter ${JSON.stringify(name)}]\n\tclean =\n\tprocess =\n\trequired = false\n`).join("");
  const key = createHash("sha256").update(text).digest("hex");
  const known = files.get(key);
  if (known) return known;
  const writing = config_dir().then(async (dir) => {
    const file = path.join(dir, key + ".gitconfig");
    try {
      await fsp.writeFile(file, text, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      await fsp.rm(file, { force: true }).catch((cleanup) => console.warn(`[git] removing incomplete filter config ${file} failed:`, cleanup));
      throw error;
    }
    return file;
  });
  files.set(key, writing);
  void writing.catch(() => files.delete(key));
  return writing;
};
