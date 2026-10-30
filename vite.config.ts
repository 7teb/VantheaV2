import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { visual_frame_file, visual_shell } from "./shared/visual-doc.ts";

const content_security_policy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: vx-media:",
  "media-src 'self' blob: vx-media:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const csp_plugin = (): Plugin => ({
  name: "vx-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${content_security_policy}" />`),
});

const visual_frame_plugin = (): Plugin => ({
  name: "vx-visual-frame",
  configureServer: (server) => {
    server.middlewares.use(`/${visual_frame_file}`, (_request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(visual_shell);
    });
  },
  generateBundle() {
    this.emitFile({ type: "asset", fileName: visual_frame_file, source: visual_shell });
  },
});

export default defineConfig({
  base: "./",
  plugins: [react(), csp_plugin(), visual_frame_plugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: ["chrome140", "safari16.4"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/.claude/**", "**/outputs/**", "**/dist-electron/**"],
    },
  },
});
