import fs from "node:fs/promises";
import { nativeImage } from "electron";
import { message_attachments } from "../../../shared/chat.ts";
import { attachment_limits } from "../../../shared/ipc/media.ts";
import { fit_native, jpeg_quality } from "../../browser/model-image.ts";
import { get_chat } from "../../chats/store.ts";
import { sniff_image } from "../../media/files.ts";
import { require_string } from "../browser/common.ts";
import { failed, guarded } from "../fs/common.ts";
import { define_tool } from "../types.ts";
import { view_target } from "./view-target.ts";

const chat_attachments = async (chat_id: string) => (await get_chat(chat_id))?.messages.flatMap(message_attachments) ?? [];

export const view_image_tool = define_tool<{ path: string }>({
  spec: {
    name: "view_image",
    description:
      "Look at an image file yourself: a PNG or JPEG in the project folder, or an attachment path from this chat. The image comes back in the next message, scaled down only as far as the current model and the provider's image limits require; the result says the size it was sent at. Use it to check an image you made or changed, or a crop of an attachment.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path, or an absolute path inside the project or of an attachment of this chat." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "plan", "explore", "worker"],
  available: (_settings, model) => model.vision,
  parse: (raw) => ({ path: require_string(raw, "path") }),
  run: (ctx, args) =>
    guarded(ctx, "view_image", async () => {
      const target = await view_target(await chat_attachments(ctx.chat_id), ctx.project_root, args.path);
      if ((await fs.stat(target.file)).size > attachment_limits.image_bytes) {
        return failed(`${target.display} is larger than 20 MB, the most view_image reads.`);
      }
      const bytes = await fs.readFile(target.file);
      const kind = sniff_image(bytes)?.ext;
      if (kind !== "png" && kind !== "jpg") {
        return failed("view_image reads PNG and JPEG files. Convert the file to PNG first.");
      }
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) {
        return failed("The image could not be decoded.");
      }
      const size = image.getSize();
      const fitted = fit_native(image, ctx.image_fit);
      const shown = fitted.getSize();
      const text = `Image ${target.display}, ${size.width}x${size.height} px, shown at ${shown.width}x${shown.height} px. It is attached in the user message after this tool result.`;
      return {
        status: "done",
        text,
        view: { kind: "text", text: target.display },
        images: [{ bytes: fitted.toJPEG(jpeg_quality), mime: "image/jpeg", label: `[view_image ${target.display}, ${shown.width}x${shown.height} px]` }],
      };
    }),
});
