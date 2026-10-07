import { protocol } from "electron";
import fs from "node:fs/promises";
import { error_code } from "../storage/coerce.ts";
import { is_media_id, media_mime, resolve_media_file, type MediaBucket } from "./files.ts";

const scheme = "vx-media";

export const register_media_scheme = () => {
  protocol.registerSchemesAsPrivileged([
    { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
};

const not_found = () => new Response(null, { status: 404 });

const serve_media = async (request: Request): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405 });
  }
  const url = new URL(request.url);
  const bucket: MediaBucket | null = url.hostname === "attachment" || url.hostname === "image" ? url.hostname : null;
  const id = url.pathname.replace(/^\/+/, "");
  if (!bucket || !is_media_id(id)) {
    return not_found();
  }
  try {
    const data = await fs.readFile(await resolve_media_file(bucket, id));
    const headers = {
      "Content-Type": media_mime(id),
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };
    return new Response(request.method === "HEAD" ? null : data, { status: 200, headers });
  } catch (error) {
    if (error_code(error) !== "ENOENT") {
      console.error(`[media] serving ${request.url} failed:`, error);
    }
    return not_found();
  }
};

export const register_media_protocol = () => {
  protocol.handle(scheme, serve_media);
};
