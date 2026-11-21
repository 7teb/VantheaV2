import type { IncomingHttpHeaders } from "node:http";
import { api_version, type InfoResult, type ModelInfo } from "../../shared/api/contract.ts";
import type { RouteId } from "../../shared/api/routes.ts";
import { attachment_limits } from "../../shared/ipc/media.ts";
import { error_text } from "../storage/coerce.ts";
import { empty_reply, invalid, json_reply, read_raw, stream_reply } from "./body.ts";
import { open_stream } from "./events.ts";
import { default_approvals, default_mode } from "./options.ts";
import type { Handler } from "./router.ts";
import { require_session } from "./routes-sessions.ts";

const upload_limit = Math.max(attachment_limits.image_bytes, attachment_limits.file_bytes);

const upload_name = (headers: IncomingHttpHeaders): string => {
  const header = headers["x-vx-name"];
  if (typeof header !== "string" || !header) {
    throw invalid("the x-vx-name header with the URI-encoded file name is required");
  }
  let name: string;
  try {
    name = decodeURIComponent(header);
  } catch (error) {
    throw invalid(`the x-vx-name header is not valid URI encoding: ${error_text(error)}`);
  }
  if (!name || name.length > 1000) {
    throw invalid("the decoded x-vx-name must be 1 to 1000 characters");
  }
  return name;
};

const upload_mime = (headers: IncomingHttpHeaders): string => {
  const mime = headers["content-type"] ?? "application/octet-stream";
  if (mime.length > 200) {
    throw invalid("the content type must be at most 200 characters");
  }
  return mime;
};

export const misc_routes = {
  info: async ({ context }) => {
    const info: InfoResult = {
      name: "VantheaX",
      version: context.version,
      api: api_version,
      headless: context.headless,
      default_model: context.settings().model,
      default_mode,
      default_approvals,
    };
    return json_reply(info);
  },
  models: async ({ context }) => {
    const models: ModelInfo[] = (await context.model_catalog()).models.map((model) => ({ id: model.id, label: model.label, efforts: model.efforts }));
    return json_reply(models);
  },
  diff: async ({ context, url, params }) => {
    require_session(context, params.id);
    const file = url.searchParams.get("path");
    if (file === null) {
      return json_reply(await context.invoke("turn_diff:summaries", params.id, [{ kind: "chat" }]));
    }
    if (!file || file.length > 4000) {
      throw invalid("path must be 1 to 4000 characters");
    }
    return json_reply(await context.invoke("turn_diff:file", params.id, { kind: "chat" }, file));
  },
  "attachments.upload": async ({ context, request }) => {
    const name = upload_name(request.headers);
    const mime = upload_mime(request.headers);
    const bytes = await read_raw(request, upload_limit);
    if (!bytes.length) {
      throw invalid("the attachment body is empty");
    }
    return json_reply(await context.invoke("attachments:save", { name, mime, bytes }));
  },
  events: async ({ request, response, url }) => {
    open_stream(request, response, url);
    return stream_reply;
  },
  shutdown: async ({ context, response }) => {
    response.once("close", () => setImmediate(context.quit));
    return empty_reply(202);
  },
} satisfies Partial<Record<RouteId, Handler>>;
