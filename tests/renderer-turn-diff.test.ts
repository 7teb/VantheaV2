import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiffNote } from "../shared/turn-diff.ts";
import { no_git_reasons } from "../shared/turn-diff.ts";
import { span_of } from "../shared/turn-span.ts";
import { badge_title, clock_label, entry_place, entry_title, full_clock_label, openable, short_clock_label, status_letters, submodule_text, totals } from "../src/features/docks/files/diff/diff-rows.ts";
import { file_note_keys, note_texts } from "../src/features/docks/files/diff/turn-diff-notes.ts";
import { tables, translate, type Translate } from "../src/i18n/translate.ts";
import { turn_segments } from "../src/state/turn-groups.ts";
import { diff_entry, messages_fixture, ready } from "./turn-diff-ui-kit.ts";

const en: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const clock = (iso: string) => `@${iso.slice(11, 16)}`;

const unfilled = /\{\w+\}/;

test("rows show the folder or the old name of a rename, and the full path or both paths as tooltip", () => {
  assert.equal(entry_place(diff_entry("src/app/main.ts")), "src/app");
  assert.equal(entry_place(diff_entry("README.md")), "");
  const renamed = diff_entry("src/new.ts", "renamed", { orig_path: "lib/old.ts" });
  assert.equal(entry_place(renamed), "← old.ts");
  assert.equal(entry_title(renamed), "lib/old.ts → src/new.ts");
  assert.equal(entry_title(diff_entry("src/app/main.ts")), "src/app/main.ts");
});

test("every status has a letter and a badge title, only submodules cannot be opened", () => {
  const statuses = ["added", "modified", "deleted", "renamed", "type_changed", "submodule"] as const;
  assert.deepEqual(
    statuses.map((status) => status_letters[status]),
    ["A", "M", "D", "R", "T", "S"],
  );
  for (const status of statuses) {
    const entry = diff_entry("a.txt", status, { orig_path: status === "renamed" ? "b.txt" : null });
    assert.ok(badge_title(en, entry).length > 0);
    assert.ok(badge_title(de, entry).length > 0);
    assert.equal(openable(entry), status !== "submodule");
  }
  assert.equal(badge_title(en, diff_entry("a.txt", "renamed", { orig_path: "b.txt" })), "Renamed from b.txt");
});

test("a submodule row shows both commits shortened to seven characters and names a missing side", () => {
  const entry = diff_entry("vendor/lib", "submodule", { commits: { from: "a1b2c3d4e5f6", to: "e4f5a6b7c8d9" } });
  assert.equal(submodule_text(entry, "none"), "a1b2c3d → e4f5a6b");
  assert.equal(submodule_text(diff_entry("vendor/new", "submodule", { commits: { from: null, to: "e4f5a6b7c8d9" } }), "none"), "none → e4f5a6b");
  assert.equal(submodule_text(diff_entry("vendor/gone", "submodule", { commits: { from: "a1b2c3d4e5f6", to: null } }), "keiner"), "a1b2c3d → keiner");
});

test("totals add up text counts and skip binary and submodule rows", () => {
  const entries = [
    diff_entry("a.txt", "modified", { added: 4, removed: 2 }),
    diff_entry("b.png", "added", { added: null, removed: null, binary: true }),
    diff_entry("c", "submodule"),
    diff_entry("d.txt", "deleted", { added: 0, removed: 9 }),
  ];
  assert.deepEqual(totals(entries), { added: 4, removed: 11 });
  assert.deepEqual(totals([]), { added: 0, removed: 0 });
});

test("the clock shows only the time for today and adds the date for another day", () => {
  const now = new Date(2026, 9, 26, 18, 30);
  const today = new Date(2026, 9, 26, 14, 2).toISOString();
  const earlier = new Date(2026, 9, 24, 9, 5).toISOString();
  assert.equal(clock_label("en", today, now), new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(today)));
  const dated = clock_label("en", earlier, now);
  assert.match(dated, /24/);
  assert.match(dated, /Oct/);
  assert.match(clock_label("de", earlier, now), /24/);
  assert.equal(short_clock_label("en", today, now), clock_label("en", today, now));
  const short = short_clock_label("en", earlier, now);
  assert.match(short, /Oct/);
  assert.doesNotMatch(short, /\d:\d\d/);
  assert.match(full_clock_label("en", earlier), /2026/);
  assert.match(full_clock_label("en", earlier), /\d:\d\d/);
});

const every_note = (): DiffNote[] => [
  ...no_git_reasons.map((reason): DiffNote => ({ kind: "no_git", reason, detail: reason === "git_too_old" ? "2.20.1" : "D:/proj" })),
  { kind: "running" },
  { kind: "end_missing", reason: "app_closed", detail: "" },
  { kind: "end_missing", reason: "snapshot_failed", detail: "fatal: disk full" },
  { kind: "unreadable", paths: ["locked.txt"] },
  { kind: "unreadable", paths: ["a.txt", "b/c.txt", "d.txt"] },
  { kind: "renames_skipped" },
  { kind: "earlier_turns_missing", before: "2026-10-26T09:15:00.000Z" },
];

test("every note kind has a filled sentence in English and German", () => {
  const notes = every_note();
  for (const t of [en, de]) {
    for (const end of ["snapshot", "next_turn", "live"] as const) {
      const texts = note_texts(t, ready([], { notes, end: { kind: end, at: "2026-10-26T14:09:00.000Z" } }), clock);
      assert.ok(texts.length >= notes.length);
      for (const text of texts) {
        assert.ok(text.length > 0);
        assert.doesNotMatch(text, unfilled, text);
      }
    }
  }
});

test("note sentences name the reason, the detail, every unreadable path and the time", () => {
  const texts = (notes: DiffNote[], end: "snapshot" | "next_turn" | "live" = "snapshot", source: "git" | "recorded" = "git") =>
    note_texts(en, ready([], { notes, source, end: { kind: end, at: "2026-10-26T14:09:00.000Z" } }), clock);
  assert.deepEqual(texts([{ kind: "no_git", reason: "git_too_old", detail: "2.20.1" }]), [
    "Git 2.20.1 is too old: only files written by the agent's file tools are shown, changes made by commands are not included",
  ]);
  assert.deepEqual(note_texts(de, ready([], { notes: [{ kind: "no_git", reason: "not_repo", detail: "D:/proj" }], source: "recorded" }), clock), [
    "Kein Git-Repository: angezeigt werden nur Dateien, die die Dateiwerkzeuge des Agenten geschrieben haben, Änderungen durch Befehle sind nicht enthalten",
  ]);
  assert.match(texts([{ kind: "no_git", reason: "ignored_folder", detail: "D:/proj" }])[0] ?? "", /repository at D:\/proj:/);
  assert.match(texts([{ kind: "no_git", reason: "snapshot_failed", detail: "fatal: oops" }])[0] ?? "", /\(fatal: oops\)/);
  assert.deepEqual(texts([{ kind: "running" }], "live"), ["Turn still running, changes so far as of @14:09"]);
  assert.deepEqual(texts([{ kind: "end_missing", reason: "app_closed", detail: "" }], "next_turn"), [
    "The app was closed during this turn, compared with the start of the next turn",
  ]);
  assert.deepEqual(texts([{ kind: "end_missing", reason: "snapshot_failed", detail: "fatal: x" }], "live"), [
    "The end snapshot of this turn failed (fatal: x), compared with the folder as of @14:09",
  ]);
  assert.deepEqual(texts([{ kind: "unreadable", paths: ["a.txt", "b/c.txt", "d.txt"] }]), ["Git could not read 3 files when the snapshot was taken: a.txt, b/c.txt, d.txt"]);
  assert.deepEqual(texts([{ kind: "unreadable", paths: ["a.txt"] }], "snapshot", "recorded"), ["1 file could not be read when its content was saved: a.txt"]);
  assert.deepEqual(texts([{ kind: "earlier_turns_missing", before: "2026-10-26T09:15:00.000Z" }], "live"), [
    "Turns before @09:15 ran without a snapshot and are not included",
    "Compared with the folder as of @14:09",
  ]);
  assert.deepEqual(texts([], "live"), ["Compared with the folder as of @14:09"]);
  assert.deepEqual(texts([]), []);
});

test("every file note kind maps to a string in both languages", () => {
  for (const key of Object.values(file_note_keys)) {
    assert.ok(tables.en[key].length > 0, key);
    assert.ok(tables.de[key].length > 0, key);
  }
  assert.equal(en(file_note_keys.binary), "Binary file, no line diff");
  assert.equal(en(file_note_keys.object_missing), "The snapshot content of this file is no longer available");
});

test("turn segments of the chat view have the same leaders and ends as span_of", () => {
  const messages = messages_fixture();
  const groups = turn_segments(messages).flatMap((segment) => (segment.kind === "turn" ? [segment.members] : []));
  assert.deepEqual(
    groups.map((members) => members.map((member) => member.id)),
    [["a1", "a2", "a3"], ["a4"], ["k1"], ["a5"], ["a6"]],
  );
  for (const members of groups) {
    const leader = members[0];
    const last = members.at(-1);
    assert.ok(leader && last);
    for (const member of members) {
      assert.deepEqual(span_of(messages, member.id), { from_id: leader.id, to_id: last.id });
    }
  }
});
