import path from "node:path";
import { build, type Plugin } from "esbuild";

const html_ns = "http://www.w3.org/1999/xhtml";

export class FakeNode {
  nodeType: number;
  nodeName: string;
  ownerDocument: FakeDocument | null;
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];

  constructor(node_type: number, node_name: string, owner: FakeDocument | null) {
    this.nodeType = node_type;
    this.nodeName = node_name;
    this.ownerDocument = owner;
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): FakeNode | null {
    return this.childNodes.at(-1) ?? null;
  }

  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get previousSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  get isConnected(): boolean {
    return this.nodeType === 9 || Boolean(this.parentNode?.isConnected);
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    for (const child of this.childNodes) {
      child.parentNode = null;
    }
    this.childNodes = [];
    if (value !== "" && this.ownerDocument) {
      this.appendChild(this.ownerDocument.createTextNode(value));
    }
  }

  appendChild(child: FakeNode) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: FakeNode, before: FakeNode | null) {
    if (before === null) {
      return this.appendChild(child);
    }
    child.parentNode?.removeChild(child);
    const at = this.childNodes.indexOf(before);
    if (at < 0) {
      throw new Error("insertBefore: the reference node is not a child");
    }
    child.parentNode = this;
    this.childNodes.splice(at, 0, child);
    return child;
  }

  removeChild(child: FakeNode) {
    const at = this.childNodes.indexOf(child);
    if (at < 0) {
      throw new Error("removeChild: the node is not a child");
    }
    this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }

  contains(other: FakeNode | null): boolean {
    for (let node = other; node; node = node.parentNode) {
      if (node === this) {
        return true;
      }
    }
    return false;
  }

  addEventListener() {}

  removeEventListener() {}
}

export class FakeText extends FakeNode {
  data: string;

  constructor(owner: FakeDocument, data: string) {
    super(3, "#text", owner);
    this.data = data;
  }

  get nodeValue() {
    return this.data;
  }

  set nodeValue(value: string) {
    this.data = value;
  }

  override get textContent() {
    return this.data;
  }

  override set textContent(value: string) {
    this.data = value;
  }
}

export class FakeElement extends FakeNode {
  namespaceURI: string;
  tagName: string;
  attributes = new Map<string, string>();
  style: Record<string, unknown> = {
    setProperty: (name: string, value: string) => void (this.style[name] = value),
    removeProperty: (name: string) => void delete this.style[name],
  };

  constructor(owner: FakeDocument, namespace: string, tag: string) {
    super(1, namespace === html_ns ? tag.toUpperCase() : tag, owner);
    this.namespaceURI = namespace;
    this.tagName = this.nodeName;
  }

  override get textContent(): string {
    return this.childNodes.filter((child) => !(child instanceof FakeElement && child.getAttribute("data-phase") === "out")).map((child) => child.textContent).join("");
  }

  override set textContent(value: string) {
    super.textContent = value;
  }

  get className() {
    return this.attributes.get("class") ?? "";
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  }

  set className(value: string) {
    this.attributes.set("class", value);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }

  setAttributeNS(_namespace: string, name: string, value: string) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  get dataset(): Record<string, string | undefined> {
    const attribute = (key: string) => `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    return new Proxy<Record<string, string | undefined>>(
      {},
      {
        get: (_target, key) => (typeof key === "string" ? this.attributes.get(attribute(key)) : undefined),
        set: (_target, key, value) => {
          if (typeof key === "string") {
            this.attributes.set(attribute(key), String(value));
          }
          return true;
        },
      },
    );
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  closest(selector: string): FakeElement | null {
    const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    if (!attribute) {
      throw new Error(`the fake DOM's closest supports only [attribute] selectors, got ${selector}`);
    }
    for (let node: FakeNode | null = this; node instanceof FakeElement; node = node.parentNode) {
      if (node.hasAttribute(attribute)) {
        return node;
      }
    }
    return null;
  }

  focus() {}

  blur() {}

  setSelectionRange() {}

  get leaving(): boolean {
    for (let node: FakeNode | null = this; node instanceof FakeElement; node = node.parentNode) {
      if (node.getAttribute("data-phase") === "out") {
        return true;
      }
    }
    return false;
  }

  matching(test: (element: FakeElement) => boolean): FakeElement[] {
    const found: FakeElement[] = [];
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) {
        if (test(child)) {
          found.push(child);
        }
        found.push(...child.matching(test));
      }
    }
    return found;
  }
}

export class FakeDocument extends FakeNode {
  documentElement: FakeElement;
  body: FakeElement;
  defaultView: unknown = null;
  visibilityState = "visible";

  constructor() {
    super(9, "#document", null);
    this.documentElement = this.createElement("html");
    this.body = this.createElement("body");
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }

  get activeElement() {
    return this.body;
  }

  createElement(tag: string) {
    return new FakeElement(this, html_ns, tag);
  }

  createElementNS(namespace: string, tag: string) {
    return new FakeElement(this, namespace, tag);
  }

  createTextNode(data: string) {
    return new FakeText(this, data);
  }

  createComment(data: string) {
    const node = new FakeText(this, data);
    node.nodeType = 8;
    node.nodeName = "#comment";
    return node;
  }
}

export const fake_window = (document: FakeDocument, extra: Record<string, unknown> = {}) => {
  const window: Record<string, unknown> = {
    document,
    event: undefined,
    HTMLIFrameElement: class {},
    navigator: { userAgent: "node" },
    innerWidth: 1440,
    innerHeight: 900,
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    ...extra,
  };
  document.defaultView = window;
  return window;
};

export type Vx = { invoke: (name: string, ...args: unknown[]) => Promise<unknown>; on: (name: string, listener: (payload: any) => void) => () => void; send: () => void };

export const quiet_vx: Vx = { invoke: async () => undefined, on: () => () => {}, send: () => {} };

const global_names = ["window", "document", "localStorage", "navigator", "ResizeObserver", "MutationObserver"];

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class FakeMutationObserver {
  observe() {}
  disconnect() {}
  takeRecords() { return []; }
}

export const install_dom = (vx: Vx) => {
  const saved = new Map(global_names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const document = new FakeDocument();
  const window = fake_window(document, { vx });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: FakeResizeObserver });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: FakeMutationObserver });
  const restore = () => {
    for (const name of global_names) {
      const descriptor = saved.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { document, restore };
};

export const stub_components = (importer: string, stubs: Record<string, string>): Plugin => ({
  name: "stub-components",
  setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: "empty" }));
    builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    builder.onResolve({ filter: /\.tsx$/ }, (args) => {
      const name = path.basename(args.path, ".tsx");
      return path.basename(args.importer) === importer && name in stubs ? { path: name, namespace: "stub" } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js", resolveDir: process.cwd() }));
  },
});

export const card_stub = (name: string) =>
  `import { createElement } from "react"; export const ${name} = (props) => createElement("div", { "data-stub": "${name}", "data-chat": String(props.chat_id) });`;

export const bundle = async (exports: string[], plugins: Plugin[]) => {
  const result = await build({
    stdin: { contents: exports.join("\n"), resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    jsx: "automatic",
    plugins,
    define: { "process.env.NODE_ENV": '"production"' },
    legalComments: "none",
    logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
};
