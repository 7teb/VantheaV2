import { describe_attachment_image } from "../../side/vision.ts";
import { ToolArgumentError, define_tool, type Tool } from "../types.ts";

type Args = { attachment_id: string; question: string };

const parse = (raw: Record<string, unknown>): Args => {
  const attachment_id = raw.attachment_id;
  if (typeof attachment_id !== "string" || !attachment_id) {
    throw new ToolArgumentError("attachment_id is required");
  }
  const question = raw.question;
  if (question !== undefined && typeof question !== "string") {
    throw new ToolArgumentError("question must be a string");
  }
  return { attachment_id, question: question ?? "" };
};

export const analyze_image_tool: Tool = define_tool<Args>({
  spec: {
    name: "analyze_image",
    description:
      "Ask a focused question about an image the user attached, by its attachment id. A separate vision model reads the image and returns a text description; you do not see the picture yourself. Use it for exact text, numbers, code or a specific region in an attached image.",
    parameters: {
      type: "object",
      properties: {
        attachment_id: { type: "string", description: "The id of the attached image to analyze." },
        question: { type: "string", description: "What to look for in the image. Leave empty for a full description." },
      },
      required: ["attachment_id"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "plan", "explore", "worker"],
  parse,
  run: async (ctx, args) => {
    const text = await describe_attachment_image(args.attachment_id, args.question, ctx.signal);
    return { status: "done", text, view: { kind: "text", text } };
  },
});
