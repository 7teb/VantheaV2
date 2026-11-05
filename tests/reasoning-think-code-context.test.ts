import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { create_content_splitter } from "../electron/model/content-split.ts";

const split = (chunks: string[]) => {
  const splitter = create_content_splitter();
  let text = "";
  let reasoning = "";
  for (const chunk of chunks) {
    const part = splitter.push(chunk);
    text += part.text;
    reasoning += part.reasoning;
    assert.equal(part.text.includes("actual"), false);
  }
  const end = splitter.finish();
  return { text: text + end.text, reasoning: reasoning + end.reasoning };
};

for (const source of [
  "    <think>literal</think>",
  "\t<think>literal</think>",
  "intro\n\n    <thinking>literal</thinking>",
  "# Heading\n    <think>literal</think>",
  "> ```xml\n> <think>literal</think>\n> ```",
  "> ~~~xml\n> <think>literal</think>\n> ~~~",
  "> > ````xml\n> > <think>literal</think>\n> > ````",
  "- ```xml\n  <think>literal</think>\n  ```",
  "1. ```xml\n   <think>literal</think>\n   ```",
  "- outer\n  - ```xml\n    <think>literal</think>\n    ```",
  "> - ```xml\n>   <think>literal</think>\n>   ```",
  "- > ```xml\n  > <think>literal</think>\n  > ```",
  ">     <think>literal</think>",
  "- item\n\n      <think>literal</think>",
  "~~~xml\n    ~~~\n<think>literal</think>\n~~~",
]) {
  test(`CommonMark code retains literal think tags ${JSON.stringify(source)}`, () => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { children: source }));
    assert.equal((html.match(/<pre>/g) ?? []).length, 1, html);
    assert.ok(html.includes("&lt;think"), html);
    for (let at = 0; at <= source.length; at += 1)
      assert.deepEqual(split([source.slice(0, at), source.slice(at)]), { text: source, reasoning: "" }, `boundary ${at}`);
    assert.deepEqual(split([...source]), { text: source, reasoning: "" });
  });
}

for (const prefix of ["intro\n    ", "> prose\n>     ", "> prose\n    ", "- prose\n    ", "=\n    ", "-*-\n    ", "> ```xml\n> example\n", "- ```xml\n  example\n\n"]) {
  test(`ordinary reasoning remains outside code ${JSON.stringify(prefix)}`, () => {
    const source = prefix + "<think>actual</think>answer";
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { children: source }));
    assert.ok((html.match(/<pre>[\s\S]*?<\/pre>/g) ?? []).every((block) => !block.includes("actual")), html);
    for (let at = 0; at <= source.length; at += 1)
      assert.deepEqual(split([source.slice(0, at), source.slice(at)]), { text: prefix + "answer", reasoning: "actual" });
  });
}
