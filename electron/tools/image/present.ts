import fs from "node:fs/promises";
import type { GeneratedImage } from "../../../shared/tool-view.ts";
import { image_size, is_media_id, media_exists, resolve_media_file } from "../../media/files.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { read_string_list } from "../web/args.ts";

type PresentArgs = { image_ids: string[] };

const max_presented = 10;

const parse_present = (raw: Record<string, unknown>): PresentArgs => {
  const image_ids = [...new Set(read_string_list(raw, "image_ids", max_presented))];
  if (!image_ids.length) {
    throw new ToolArgumentError("image_ids must name at least one generated image");
  }
  return { image_ids };
};

const generated_image = async (id: string, signal: AbortSignal): Promise<GeneratedImage | null> => {
  if (!is_media_id(id) || !id.startsWith("img_") || !(await media_exists("image", id))) {
    return null;
  }
  const size = image_size(await fs.readFile(await resolve_media_file("image", id), { signal }));
  return { id, width: size?.width ?? null, height: size?.height ?? null };
};

export const present_images_tool = define_tool<PresentArgs>({
  spec: {
    name: "present_images",
    description:
      "Show images you generated with generate_image to the user in the chat. generate_image does not show its result, so this call decides where the images appear: at the point of the call, between your texts. Usually call it once, after all generating and editing is done, with every image the user should see, and write your closing text after it. Leave out drafts you replaced. Pass the ids exactly as generate_image returned them, up to 10 per call; an image can be shown again later. For image files on disk, use show_images.",
    parameters: {
      type: "object",
      properties: {
        image_ids: { type: "array", items: { type: "string" }, description: "Ids of generated images to show, in the order they should appear." },
      },
      required: ["image_ids"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  available: (settings) => settings.image_gen.enabled,
  parse: parse_present,
  run: async (ctx, args) => {
    const images: GeneratedImage[] = [];
    for (const id of args.image_ids) {
      const image = await generated_image(id, ctx.signal);
      if (!image) {
        return { status: "failed", text: `No generated image with the id "${id.slice(0, 80)}" exists. Pass the id exactly as generate_image returned it.`, view: null };
      }
      images.push(image);
    }
    const text = `The user now sees ${images.length === 1 ? "this image" : `these ${images.length} images`} in the chat: ${images.map((image) => image.id).join(", ")}.`;
    return { status: "done", text, view: { kind: "image", images } };
  },
});
