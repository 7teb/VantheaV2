import assert from "node:assert/strict";
import { test } from "node:test";
import { create_content_splitter } from "../electron/model/content-split.ts";
import { create_accumulator } from "../electron/model/accumulator.ts";
import { has_math, normalize_math, split_blocks } from "../src/components/markdown-blocks.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

const split = (chunks: string[]) => {
  const splitter = create_content_splitter();
  let text = "";
  let reasoning = "";
  for (const chunk of chunks) {
    const part = splitter.push(chunk);
    text += part.text;
    reasoning += part.reasoning;
  }
  const end = splitter.finish();
  return { text: text + end.text, reasoning: reasoning + end.reasoning, held: end.held };
};

for (const source of [
  "```xml\n<think>example</think>\n```",
  "~~~~xml\n<thinking>example</thinking>\n~~~~",
  "````md\n```\n<think>example</think>\n````",
  "   ```xml\r\n<think>example</think>\r\n   ```",
  "`<think>example</think>`",
  "``<thinking>example</thinking>``",
  "```xml\n</think>\n<thinking>example</thinking>\n```",
]) {
  test(`think markers remain literal code ${JSON.stringify(source)}`, () => {
    for (let at = 0; at <= source.length; at += 1)
      assert.deepEqual(split([source.slice(0, at), source.slice(at)]), { text: source, reasoning: "", held: "" }, `chunk boundary ${at}`);
    assert.deepEqual(split([...source]), { text: source, reasoning: "", held: "" });
  });
}

test("unfinished think-marker prefixes inside code survive finish", () => {
  for (const prefix of ["<t", "<thi", "</think", "<thinking"])
    assert.deepEqual(split(["```xml\n", prefix]), { text: "```xml\n" + prefix, reasoning: "", held: "" });
});

test("real reasoning after a closed fence and inline span is still extracted", () => {
  for (const code of ["```xml\n<think>literal</think>\n```\n", "`<think>literal</think>` "]) {
    const source = code + "<think>actual</think>answer";
    for (let at = 0; at <= source.length; at += 1)
      assert.deepEqual(split([source.slice(0, at), source.slice(at)]), { text: code + "answer", reasoning: "actual", held: "" });
  }
});

test("the accumulator preserves code-tag examples as visible content", () => {
  const accumulator = create_accumulator();
  const source = "```xml\n<think>example</think>\n```";
  for (const char of source) accumulator.push({ choices: [{ delta: { content: char } }] });
  const end = accumulator.finish(new Set(), () => "id");
  assert.equal(end.content, source);
  assert.equal(end.reasoning, "");
});

for (const source of [
  "````md\n```\nprice $5 and \\(x\\)\n````",
  "`````md\n````\n$x$\n```\n\\[x\\]\n`````",
  "~~~md\n```\n$x$\n~~~",
  "   ````md\r\n```\r\n$x$\r\n   `````\r\n",
  "````md\n```\n$x$",
  "``$5 ` \\(x\\)``",
]) {
  test(`math preprocessing preserves complete code regions ${JSON.stringify(source)}`, () => {
    assert.equal(normalize_math(source), source);
    assert.equal(has_math(source), false);
  });
}

test("math after a real matching fence still normalizes", () => {
  const code = "````md\n```\n$x$\n````";
  assert.equal(normalize_math(code + "\n\nOutside \\(y\\), $5"), code + "\n\nOutside $y$, \\$5");
  assert.equal(has_math(code + "\n\n$y$"), true);
  assert.deepEqual(split_blocks(code + "\n\nOutside"), [code, "Outside"]);
});

test("invalid or too deeply indented closing fences cannot end a code region", () => {
  for (const close of ["```", "~~~", "```` language", "    ````"]) {
    const code = "````md\n" + close + "\n\n$x$\n````";
    assert.equal(normalize_math(code), code);
    assert.deepEqual(split_blocks(code + "\n\nOutside"), [code, "Outside"]);
  }
});

test("fence-length and indentation matrix stays literal through preprocessing", () => {
  for (const char of ["`", "~"]) {
    for (const size of [3, 4, 5, 8]) {
      for (const indent of ["", " ", "  ", "   "]) {
        const source = indent + char.repeat(size) + "md\n" + char.repeat(size - 1) + "\n$x$ \\(z\\)\n" + indent + char.repeat(size + 1);
        assert.equal(normalize_math(source), source);
        assert.equal(has_math(source), false);
      }
    }
  }
});

test("inline code requires a matching run and preserves escaped backticks", () => {
  assert.equal(normalize_math("\\`price $5"), "\\`price \\$5");
  assert.equal(normalize_math("`price $5"), "`price \\$5");
  assert.equal(normalize_math("``a ` $5 \\(x\\)`` and $6"), "``a ` $5 \\(x\\)`` and \\$6");
  assert.equal(normalize_math("``a\n$x$\nb``"), "``a\n$x$\nb``");
});

test("the actual Markdown parser receives complete unmodified nested-fence content", () => {
  const source = "````md\n```xml\n<think>literal</think>\n```\n$x$ \\(y\\)\n````";
  const normalized = normalize_math(source);
  assert.equal(normalized, source);
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { children: normalized }));
  assert.equal((html.match(/<pre>/g) ?? []).length, 1);
  assert.ok(html.includes("```xml\n&lt;think&gt;literal&lt;/think&gt;\n```\n$x$ \\(y\\)"));
});
