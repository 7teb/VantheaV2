import fs from "node:fs/promises";
import path from "node:path";
import { attachment_limits } from "../../../shared/ipc/media.ts";
import type { ShownImage } from "../../../shared/tool-view.ts";
import { image_size, save_tool_images, sniff_image } from "../../media/files.ts";
import { failed, guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { read_string_list } from "../web/args.ts";

type ShowArgs = { paths: string[] };

const parse_show = (raw: Record<string, unknown>): ShowArgs => {
  const paths = read_string_list(raw, "paths", attachment_limits.max_files);
  if (!paths.length) {
    throw new ToolArgumentError("paths must name at least one image file");
  }
  return { paths };
};

export const show_images_tool = define_tool<ShowArgs>({
  spec: {
    name: "show_images",
    description:
      "Show image files from disk to the user in the chat. Use it when the user should see an image: one you created, rendered, converted or captured (a screenshot, a chart, an exported figure), or one they asked you to find. Paths are project-relative or absolute, in any folder. PNG, JPEG, GIF, WebP and BMP, up to 20 MB each and 10 per call. Only the user sees the images; to look at one yourself, use view_image.",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "The image files to show, project-relative or absolute." },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "plan"],
  parse: parse_show,
  run: (ctx, args) =>
    guarded(ctx, "show_images", async () => {
      const loaded: { file: string; bytes: Buffer; mime: string }[] = [];
      for (const entry of args.paths) {
        const file = path.resolve(ctx.project_root, entry);
        if ((await fs.stat(file)).size > attachment_limits.image_bytes) {
          return failed(`${file} is larger than 20 MB, the most show_images shows.`);
        }
        const bytes = await fs.readFile(file);
        const kind = sniff_image(bytes);
        if (!kind) {
          return failed(`${file} is not a PNG, JPEG, GIF, WebP or BMP image.`);
        }
        loaded.push({ file, bytes, mime: kind.mime });
      }
      const ids = await save_tool_images(loaded);
      const images: ShownImage[] = loaded.map((image, at) => {
        const size = image_size(image.bytes);
        return { id: ids[at], path: image.file, width: size?.width ?? null, height: size?.height ?? null };
      });
      const text = `The user now sees ${images.length === 1 ? "this image" : `these ${images.length} images`} in the chat: ${images.map((image) => image.path).join(", ")}. The images are not sent to you.`;
      return { status: "done", text, view: { kind: "shown_images", images } };
    }),
});
