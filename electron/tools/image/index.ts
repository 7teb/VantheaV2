import fs from "node:fs/promises";
import type { GeneratedImage, ToolView } from "../../../shared/tool-view.ts";
import { chat_meta } from "../../chats/store.ts";
import { save_generated_image } from "../../media/artifacts.ts";
import { is_media_id, media_exists, resolve_media_file, sniff_image } from "../../media/files.ts";
import { model_catalog } from "../../model/catalog-file.ts";
import { error_text } from "../../storage/coerce.ts";
import { require_string } from "../browser/common.ts";
import { define_tool, type ToolResult } from "../types.ts";
import { read_string_list } from "../web/args.ts";
import { reference_data_url, image_size } from "./native.ts";
import { image_input_support, request_images } from "./openrouter.ts";
import { image_body } from "./request.ts";

type ImageArgs = { prompt: string; source_images: string[] };

const max_source_images = 4;

const image_view = (prompt: string, images: GeneratedImage[]): ToolView => ({ kind: "image", prompt, images });

const failed = (prompt: string, text: string): ToolResult => ({ status: "failed", text, view: image_view(prompt, []) });

const read_source = async (id: string): Promise<string> => {
  if (!is_media_id(id) || !id.startsWith("img_")) {
    throw new Error(`"${id.slice(0, 80)}" is not an image id`);
  }
  const bucket = (await media_exists("attachment", id)) ? "attachment" : "image";
  const bytes = await fs.readFile(await resolve_media_file(bucket, id));
  const kind = sniff_image(bytes);
  if (!kind) {
    throw new Error(`${id} is not a recognized image`);
  }
  return reference_data_url(bytes, kind.mime);
};

export const generate_image_tool = define_tool<ImageArgs>({
  spec: {
    name: "generate_image",
    description:
      "Generate or edit an image with a dedicated image model; the result is shown to the user directly in the chat. WHEN to call: ONLY when the user explicitly asked for an image (a logo, artwork, mockup, photo edit, 'generate/draw/make me a picture of ...'), or when you offered it and the user said yes. If an image would merely be nice but was NOT requested, ASK the user in plain text first and do NOT call this tool. Never generate images unprompted and never as decoration. To EDIT or transform an image, pass its id in source_images: an image the user attached (the id from its attachment note) or one you generated earlier in this chat (the id this tool returned). Write prompt as one complete, self-contained visual description in English (subject, style, composition, colors, any text to render); the image model sees nothing of this chat except the prompt and the source images. The user sees the result automatically, you only get back the saved image id.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Complete visual description of the image to generate, or the edit to apply to the source images. English, specific, self-contained.",
        },
        source_images: {
          type: "array",
          items: { type: "string" },
          description: "Optional. Ids of up to 4 images to use as pixel input for edits or transformations: images the user attached or images you generated earlier in this chat. Pass each id exactly as shown.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  available: (settings) => settings.image_gen.enabled,
  parse: (raw) => ({
    prompt: require_string(raw, "prompt").trim().slice(0, 4000),
    source_images: read_string_list(raw, "source_images", max_source_images),
  }),
  run: async (ctx, args) => {
    const catalog = await model_catalog();
    const model = catalog.image_models.find((entry) => entry.id === ctx.settings.image_gen.model) ?? catalog.image_models[0];
    if (!model) {
      return failed(args.prompt, "The model catalog lists no image models, so no image can be generated.");
    }
    const references: string[] = [];
    for (const id of args.source_images) {
      try {
        references.push(await read_source(id));
      } catch (error) {
        console.warn(`[image] source image ${id.slice(0, 80)} could not be read: ${error_text(error)}`);
        return failed(args.prompt, `No readable image with the id "${id.slice(0, 80)}" was found. Use the id exactly as shown in its attachment note or in the earlier generate_image result.`);
      }
    }
    if (references.length && (await image_input_support(model.id)) === false) {
      return failed(args.prompt, `The selected image model ${model.label} cannot take images as input, so it cannot edit. Ask the user to pick another image model in Settings > Image generation.`);
    }
    try {
      const body = image_body({ model, prompt: args.prompt, quality: ctx.settings.image_gen.quality, references });
      const decoded = await request_images(body, ctx.signal);
      if (!decoded.length) {
        return failed(args.prompt, `The image model ${model.label} returned no image. It may have declined the prompt.`);
      }
      const images: GeneratedImage[] = [];
      const project_path = chat_meta(ctx.chat_id)?.project_path ?? "";
      for (const image of decoded) {
        const saved = await save_generated_image(image.bytes, image.mime, { prompt: args.prompt, chat_id: ctx.chat_id, project_path });
        images.push({ id: saved.id, ...image_size(image.bytes) });
      }
      const ids = images.map((image) => image.id).join(", ");
      const text = `Generated ${images.length} image${images.length === 1 ? "" : "s"} with ${model.label}: ${ids}. The user already sees it in the chat. To edit it later, pass its id in source_images.`;
      return { status: "done", text, view: image_view(args.prompt, images) };
    } catch (error) {
      if (ctx.signal.aborted) {
        throw error;
      }
      console.warn(`[image] generation with ${model.id} failed: ${error_text(error)}`);
      return failed(args.prompt, `Image generation with ${model.label} failed: ${error_text(error)}`);
    }
  },
});
