import { get_settings } from "../settings/store.ts";

const page_text = {
  en: {
    lang: "en",
    unpaired_title: "Not paired",
    unpaired: "This device is not paired. On the PC, open the phone icon in the VantheaX title bar and scan the QR code.",
    missing_title: "Renderer missing",
    missing: "The renderer bundle is missing, run npm run build.",
  },
  de: {
    lang: "de",
    unpaired_title: "Nicht gekoppelt",
    unpaired: "Dieses Gerät ist nicht gekoppelt. Am PC in der VantheaX-Titelleiste das Handy-Symbol öffnen und den QR-Code scannen.",
    missing_title: "Renderer fehlt",
    missing: "Das Renderer-Bundle fehlt, npm run build ausführen.",
  },
} as const;

export const page_csp = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'";

const page = (lang: string, title: string, text: string) =>
  [
    "<!doctype html>",
    `<html lang="${lang}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="dark light">',
    `<title>VantheaX: ${title}</title>`,
    "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;font-size:16px;line-height:1.5}main{max-width:32rem;padding:24px}</style>",
    "</head>",
    "<body>",
    `<main><h1>${title}</h1><p>${text}</p></main>`,
    "</body>",
    "</html>",
  ].join("\n");

const texts = () => page_text[get_settings().language];

export const unpaired_page = (): string => {
  const text = texts();
  return page(text.lang, text.unpaired_title, text.unpaired);
};

export const missing_bundle_page = (): string => {
  const text = texts();
  return page(text.lang, text.missing_title, text.missing);
};
