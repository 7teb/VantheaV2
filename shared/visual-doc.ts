export const visual_message_source = "vx-visual";

export const visual_frame_file = "visual-frame.html";

export const visual_height_limit = 8000;

export const visual_csp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

const error_limit = 300;

const base_css = `
*, *::before, *::after { box-sizing: border-box; }
html { margin: 0; padding: 0; overflow: hidden; background: transparent; }
body {
  display: flow-root;
  margin: 0;
  background: transparent;
  color: var(--vx-text);
  font-family: var(--vx-font);
  font-size: var(--vx-size-body);
  line-height: 1.625;
  font-synthesis-weight: none;
  font-variant-ligatures: none;
  overflow-wrap: break-word;
}
button, input, select, textarea { font: inherit; color: inherit; }
code, kbd, pre, samp { font-family: var(--vx-mono); }
* { scrollbar-width: thin; scrollbar-color: var(--vx-fill-strong) transparent; }
`;

const reporter = `
(() => {
  const host = window.parent;
  const source = ${JSON.stringify(visual_message_source)};
  const post = (message) => host.postMessage(Object.assign({ source }, message), "*");
  let posted = -1;
  let width = innerWidth;
  let coupled = false;
  const measure = () => {
    const body = document.body;
    const rect = body.getBoundingClientRect();
    const margin = parseFloat(getComputedStyle(body).marginBottom) || 0;
    return Math.ceil(rect.top + scrollY + Math.max(rect.height, body.scrollHeight) + margin);
  };
  const report = () => {
    if (!document.body) {
      return;
    }
    const height = measure();
    if (height === posted || (coupled && height > posted)) {
      return;
    }
    posted = height;
    post({ height });
  };
  addEventListener("resize", () => {
    coupled = innerWidth === width && innerHeight === posted;
    width = innerWidth;
    setTimeout(() => {
      coupled = false;
    }, 0);
  });
  addEventListener("DOMContentLoaded", () => {
    const observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
    observer.observe(document.body);
    report();
  });
  addEventListener("load", report);
  document.fonts.ready.then(report);
  const text = (value) => String(value).slice(0, ${error_limit});
  addEventListener("error", (event) => {
    if (event.error === null) {
      return;
    }
    post({ error: text(event.message || event.error) });
  });
  addEventListener("unhandledrejection", (event) => post({ error: text(event.reason) }));
  addEventListener(
    "click",
    (event) => {
      if (event.target.closest?.("a[href]")) {
        event.preventDefault();
      }
    },
    true,
  );
})();
`;

const loader = `
(() => {
  let written = false;
  addEventListener("message", (event) => {
    if (written || event.source !== parent || typeof event.data !== "string") {
      return;
    }
    written = true;
    document.open();
    document.write(event.data);
    document.close();
  });
  parent.postMessage({ source: ${JSON.stringify(visual_message_source)}, ready: true }, "*");
})();
`;

const policy_meta = `<meta http-equiv="Content-Security-Policy" content="${visual_csp}">`;

export const visual_shell = [
  "<!doctype html>",
  "<html>",
  "<head>",
  '<meta charset="utf-8">',
  policy_meta,
  '<meta name="color-scheme" content="dark">',
  "</head>",
  "<body>",
  `<script>${loader}</script>`,
  "</body>",
  "</html>",
].join("\n");

export const visual_document = (code: string, vars_css: string): string =>
  [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    policy_meta,
    `<style>\n:root { color-scheme: dark; ${vars_css} }\n${base_css}</style>`,
    `<script>${reporter}</script>`,
    "</head>",
    "<body>",
    code,
    "</body>",
    "</html>",
  ].join("\n");

export type VisualMessage = { kind: "ready" } | { kind: "height"; height: number } | { kind: "error"; error: string };

export const read_visual_message = (data: unknown): VisualMessage | null => {
  if (typeof data !== "object" || data === null || !("source" in data) || data.source !== visual_message_source) {
    return null;
  }
  if ("ready" in data && data.ready === true) {
    return { kind: "ready" };
  }
  if ("height" in data && typeof data.height === "number" && Number.isFinite(data.height) && data.height >= 0) {
    return { kind: "height", height: Math.min(Math.ceil(data.height), visual_height_limit) };
  }
  if ("error" in data && typeof data.error === "string") {
    return { kind: "error", error: data.error.slice(0, error_limit) };
  }
  return null;
};
