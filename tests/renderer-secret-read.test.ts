import assert from "node:assert/strict";
import { test } from "node:test";
import { secret_read_subject, skips_unanswered, full_mode_covers, type ApprovalRequest } from "../shared/approval.ts";
import { approval_question, grant_options } from "../src/features/tools/approval-options.ts";
import { approval_lines } from "../src/features/tools/review-notes.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const request = (reviewed: boolean): ApprovalRequest => ({
  kind: "secret_read",
  tool: "grep_files",
  path: "config/.env",
  query: "API_KEY",
  ...(reviewed ? { review: { id: "r1", source: "model" as const, reason: "Unclear whether the user allows reading the key.", rule_source: "none" as const, rule: "" } } : {}),
});

test("a secret_read card names the path in both languages, offers one approval and shows the review reason", () => {
  const asked = approval_question(request(false));
  assert.equal(t(asked.key, asked.vars), "May I read config/.env? It can contain keys or credentials.");
  assert.equal(de(asked.key, asked.vars), "Darf ich config/.env lesen? Es kann Schlüssel oder Zugangsdaten enthalten.");
  assert.deepEqual(grant_options(request(true)).map((option) => option.grant), ["once"]);
  assert.deepEqual(approval_lines(t, request(false)), []);
  assert.deepEqual(approval_lines(t, request(true)).map((line) => line.text), ["Automatic review: Unclear whether the user allows reading the key."]);
});

test("a secret_read card is never covered by a full window and skips like other reviewed cards", () => {
  assert.equal(full_mode_covers(request(true)), false);
  assert.equal(skips_unanswered(request(true)), true);
  assert.equal(skips_unanswered(request(false)), false);
  assert.equal(secret_read_subject({ tool: "read_file", path: ".env", query: null }), "path: .env");
});
