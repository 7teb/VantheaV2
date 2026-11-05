import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandSources } from "../electron/permissions/sources.ts";
import { send_candidate } from "../electron/permissions/source-files.ts";

export const sent_text = (sources: CommandSources): string =>
  sources.files.filter(send_candidate).map((file) => `${file.path || "payload"}\n${file.text}`).join("\n\n");

export const fixture = async (files: Record<string, string>): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-sources-"));
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }
  return root;
};

export const native_bytes = (size = 64): Buffer => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(Math.max(0, size - 2))]);

export type FixtureEnv = { root: string; temp: string; bin: string; env: Record<string, string> };

export const fixture_env = async (files: Record<string, string> = {}): Promise<FixtureEnv> => {
  const root = await fs.realpath(await fixture(files));
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "vx-sources-temp-")));
  const bin = path.join(temp, "bin");
  await fs.mkdir(bin);
  return { root, temp, bin, env: { PATH: bin, TEMP: temp, PATHEXT: ".COM;.EXE;.BAT;.CMD" } };
};

export const fact_rows = (sources: CommandSources): string[][] => sources.programs.map((fact) => [fact.written, fact.how, fact.path, fact.kind]);
