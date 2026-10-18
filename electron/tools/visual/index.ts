import { visual_tool_name, visual_vars } from "../../../shared/visual.ts";
import { define_tool, ToolArgumentError } from "../types.ts";

type VisualArgs = { title: string; code: string };

export const visual_result_text = `The visualization is now shown to the user inline at this point of your answer. Do not repeat its content in prose; continue the answer around it. Do not call ${visual_tool_name} again for the same content.`;

const var_lines = visual_vars.map((entry) => `${entry.name}: ${entry.use}`).join("\n");

const description = [
  "Show an interactive visualization inline in your answer, at the point where you call it: an HTML fragment with SVG, canvas and vanilla JS that the user sees in the chat as part of the answer.",
  "",
  "When to use it: when a visual makes the answer clearly easier to understand. How something works; a step-by-step walkthrough (a pointer chain resolved hop by hop, an algorithm stepping through its state); a comparison; numbers and metrics (a chart, a small calculator or simulator with sliders); an architecture or data-flow diagram; a small interactive structure that belongs to the answer (a checklist, a filterable table). Plain prose stays prose: most answers need none, and one answer has at most one or two. When the user asks for a visualized answer, for example with the /visualize command, use it.",
  "",
  `When not to use it: never to build a website, web app, landing page, game, component or any page the user asked to create, save, run or deploy, and never as a preview of one. Those are files written into the project with the file tools. It never replaces code the user asked for: "build me a site" is answered with files, not with ${visual_tool_name}.`,
  "",
  "Environment: code goes into a document the app provides, so send only the fragment (markup, <style> and <script> inline, no doctype, html, head or body) and put each <script> after the markup it uses. It renders in the chat column, about 700 to 760 px wide, and must also work narrower: percentages, flex, grid, SVG with a viewBox, no fixed page width. Dark theme only. The height follows the content automatically: never use 100vh or a fixed document height, no position: fixed, no inner scroll areas unless a list is genuinely long. The background is transparent so the widget sits directly in the answer; draw a card (background var(--vx-surface), border 1px solid var(--vx-border), border-radius var(--vx-radius)) only when grouping controls and results into one unit helps.",
  "",
  "Every colour, font and radius comes from these injected CSS variables, never from literal colour values:",
  var_lines,
  'For a tint use color-mix(in srgb, var(--vx-accent) 20%, transparent). In SVG set colours through CSS (style="fill: var(--vx-accent)" or a class); in canvas read a value with getComputedStyle(document.body).getPropertyValue("--vx-accent"). Typography: font-family var(--vx-font), body text var(--vx-size-body), muted labels in var(--vx-text-secondary) or var(--vx-text-tertiary), hex values, addresses and code in var(--vx-mono). Visible text is in the user\'s language.',
  "",
  "Sandbox limits, the code fails otherwise: no network and no external URLs of any kind (fetch, XHR, WebSocket, remote images, fonts, scripts, CDNs and libraries are all blocked), so write plain HTML, SVG, canvas and vanilla JS with every value inline. localStorage, sessionStorage, IndexedDB and cookies throw here; keep state in JS variables. No alert, confirm or prompt. Forms do not submit: handle input and click events in JS. Links cannot open anything.",
  "",
  "Quality: interactive where it helps understanding (sliders that update numbers live, next and back buttons for steps, hover details, filters), consistent spacing, no decorative clutter, a label on every axis and value with its unit, readable contrast. The surrounding answer text introduces or follows up on the widget instead of repeating what it shows.",
].join("\n");

const read_text = (raw: Record<string, unknown>, key: keyof VisualArgs, expected: string): string => {
  const value = raw[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolArgumentError(`${key} must be a non-empty string: ${expected}. Nothing was shown; call ${visual_tool_name} again with ${key} filled in.`);
  }
  return value;
};

export const visualize_tool = define_tool<VisualArgs>({
  spec: {
    name: visual_tool_name,
    description,
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short name of the visualization in the user's language. It labels the tool row and the frame and is not drawn above the widget, so put a visible heading into code when one helps.",
        },
        code: {
          type: "string",
          description: "The HTML fragment: markup with <style> and <script> inline, colours and fonts from the --vx-* variables.",
        },
      },
      required: ["title", "code"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "plan"],
  parse: (raw) => ({
    title: read_text(raw, "title", "a short name of the visualization in the user's language").replace(/\s+/g, " ").trim(),
    code: read_text(raw, "code", "the HTML fragment with its markup, <style> and <script> inline"),
  }),
  run: async (...[, args]) => ({ status: "done", text: visual_result_text, view: { kind: "visual", title: args.title, code: args.code } }),
});
