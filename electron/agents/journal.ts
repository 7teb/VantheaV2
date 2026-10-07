import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { error_code, error_text } from "../storage/coerce.ts";

type Journal = { lines: string[]; timer: ReturnType<typeof setTimeout> | null; chain: Promise<void>; ready: boolean };

const flush_delay_ms = 500;

const journals = new Map<string, Journal>();

const journal_for = (file: string): Journal => {
  const existing = journals.get(file);
  if (existing) {
    return existing;
  }
  const created: Journal = { lines: [], timer: null, chain: Promise.resolve(), ready: false };
  journals.set(file, created);
  return created;
};

const write_lines = async (file: string, journal: Journal, lines: string[]) => {
  try {
    if (!journal.ready) {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      journal.ready = true;
    }
    await fsp.appendFile(file, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    console.error(`[agents] appending ${lines.length} event(s) to ${file} failed: ${error_text(error)}`);
  }
};

export const flush_journal = (file: string): Promise<void> => {
  const journal = journals.get(file);
  if (!journal) {
    return Promise.resolve();
  }
  if (journal.timer) {
    clearTimeout(journal.timer);
    journal.timer = null;
  }
  if (journal.lines.length) {
    const lines = journal.lines;
    journal.lines = [];
    journal.chain = journal.chain.then(() => write_lines(file, journal, lines));
  }
  return journal.chain;
};

export const append_journal = (file: string, value: unknown): void => {
  const journal = journal_for(file);
  journal.lines.push(JSON.stringify(value));
  if (journal.timer) {
    return;
  }
  journal.timer = setTimeout(() => {
    journal.timer = null;
    void flush_journal(file);
  }, flush_delay_ms);
  journal.timer.unref();
};

export const close_journal = async (file: string): Promise<void> => {
  await flush_journal(file);
  const journal = journals.get(file);
  if (journal && !journal.lines.length && !journal.timer) {
    journals.delete(file);
  }
};

export const drop_journal = (file: string): void => {
  const journal = journals.get(file);
  if (journal?.timer) {
    clearTimeout(journal.timer);
  }
  journals.delete(file);
};

export const flush_journals_sync = (): void => {
  for (const [file, journal] of journals) {
    if (journal.timer) {
      clearTimeout(journal.timer);
      journal.timer = null;
    }
    if (!journal.lines.length) {
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${journal.lines.join("\n")}\n`, "utf8");
    } catch (error) {
      console.error(`[agents] appending ${journal.lines.length} event(s) to ${file} on quit failed: ${error_text(error)}`);
    }
    journal.lines = [];
  }
};

export const read_journal = async (file: string): Promise<unknown[]> => {
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return [];
    }
    throw error;
  }
  const out: unknown[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      out.push(JSON.parse(line));
    } catch (error) {
      console.warn(`[agents] skipping unreadable line ${index + 1} of ${file}: ${error_text(error)}`);
    }
  }
  return out;
};
