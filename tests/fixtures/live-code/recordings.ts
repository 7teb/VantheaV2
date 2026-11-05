import { readFileSync } from "node:fs";

export type RecordedRead = { t: number; text: string };

export type Recording = { name: string; reads: RecordedRead[] };

export const recording_names = ["anthropic_claude-haiku-5.5", "deepseek_deepseek-v4.1-flash", "google_gemini-3.8-flash", "openai_gpt-6-luna"];

export const load_recording = (name: string): Recording => {
  const raw = JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8")) as { reads: RecordedRead[] };
  return { name, reads: raw.reads };
};

export const recorded_chunks = (recording: Recording): unknown[] =>
  recording.reads.flatMap((read) =>
    read.text
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice("data: ".length)) as unknown),
  );
