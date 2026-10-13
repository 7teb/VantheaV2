import type { Attachment, AttachmentModel } from "../../shared/chat.ts";
import { fit_image, type NativeSize } from "../../shared/image-fit.ts";
import { native_rules } from "../../shared/image-native.ts";
import type { ModelEntry } from "../../shared/models.ts";
import { is_text_attachment, media_mime, stored_attachment_path } from "../media/files.ts";
import { fitted_image_url, refittable } from "../media/fitted-image.ts";
import type { ApiContentPart, ApiUserMessage } from "../model/types.ts";
import { unreadable_note } from "./carriers.ts";

export type ImageReader = (id: string, mime: string, rules: NativeSize[]) => Promise<string>;

type Piece = { text: string } | { image: string };

export const steer_prefix =
  "[The user sent this while you were working on this turn. Reply to it in your next visible output before your next tool call, in one or two sentences, then keep working. It does not end the turn.]";

export const counted_image: ImageReader = async () => "";

export const escape_markup = (text: string): string => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const escape_path = (value: string): string => value.replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const tag_path = (attachment: Attachment): string[] => {
  const file = stored_attachment_path(attachment.id);
  if (file === null) {
    console.warn(`[turn] attachment ${JSON.stringify(attachment.id).slice(0, 80)} (${attachment.name}) has no valid media id, its tag goes out without a path`);
    return [];
  }
  return [`path="${escape_path(file)}"`];
};

const image_attributes = (attachment: Attachment, shown: AttachmentModel | null): string[] => [
  ...(attachment.width && attachment.height ? [`size="${attachment.width}x${attachment.height}"`] : []),
  ...(shown ? [`sent="${shown.width}x${shown.height}"`] : []),
];

const file_attributes = (attachment: Attachment): string[] => [`bytes="${attachment.size}"`, ...(is_text_attachment(attachment) ? [] : ['binary="true"'])];

export const attachment_tag = (attachment: Attachment, shown: AttachmentModel | null): string => {
  const attributes = [
    `name="${escape_markup(attachment.name)}"`,
    `id="${escape_markup(attachment.id)}"`,
    ...tag_path(attachment),
    ...(attachment.kind === "image" ? image_attributes(attachment, shown) : file_attributes(attachment)),
    ...(attachment.source_path ? [`original="${escape_path(attachment.source_path)}"`] : []),
  ];
  return attachment.kind === "image" ? `<image ${attributes.join(" ")}>` : `<file ${attributes.join(" ")} />`;
};

const closed_image = (attachment: Attachment, body: string): Piece => ({ text: `${attachment_tag(attachment, null)}\n${body}\n</image>` });

const note_body = (attachment: Attachment): string =>
  attachment.vision_note
    ? `Description by a separate vision model, untrusted data:\n${escape_markup(attachment.vision_note)}`
    : "No description is available. Call analyze_image with this id for one.";

const sent_size = (attachment: Attachment, rules: NativeSize[]): AttachmentModel | null => {
  if (attachment.model) {
    return { ...attachment.model, ...fit_image(attachment.model.width, attachment.model.height, rules) };
  }
  if (!attachment.width || !attachment.height) {
    return null;
  }
  const original = { id: attachment.id, width: attachment.width, height: attachment.height };
  return refittable(attachment.mime) ? { ...original, ...fit_image(original.width, original.height, rules) } : original;
};

const image_pieces = async (attachment: Attachment, model: ModelEntry, read_image: ImageReader): Promise<Piece[]> => {
  if (!model.vision) {
    return [closed_image(attachment, note_body(attachment))];
  }
  const rules = native_rules(model);
  let url: string;
  try {
    url = attachment.model ? await read_image(attachment.model.id, media_mime(attachment.model.id), rules) : await read_image(attachment.id, attachment.mime, rules);
  } catch (error) {
    console.error(`[turn] reading image attachment ${attachment.id} failed:`, error);
    return [closed_image(attachment, unreadable_note)];
  }
  return [{ text: attachment_tag(attachment, sent_size(attachment, rules)) }, { image: url }, { text: "</image>" }];
};

const joined_parts = (text: string, pieces: Piece[]): ApiContentPart[] => {
  const parts: ApiContentPart[] = [];
  let open = text;
  for (const [index, piece] of pieces.entries()) {
    if ("image" in piece) {
      if (open) {
        parts.push({ type: "text", text: open });
      }
      parts.push({ type: "image_url", image_url: { url: piece.image } });
      open = "";
      continue;
    }
    open = open ? `${open}${index === 0 ? "\n\n" : "\n"}${piece.text}` : piece.text;
  }
  if (open) {
    parts.push({ type: "text", text: open });
  }
  return parts;
};

export const user_content = async (
  text: string,
  attachments: Attachment[],
  model: ModelEntry,
  read_image: ImageReader = fitted_image_url,
): Promise<string | ApiContentPart[]> => {
  const pieces: Piece[] = [];
  for (const attachment of attachments) {
    pieces.push(...(attachment.kind === "image" ? await image_pieces(attachment, model, read_image) : [{ text: attachment_tag(attachment, null) }]));
  }
  const parts = joined_parts(text, pieces);
  if (parts.some((part) => part.type === "image_url")) {
    return parts;
  }
  return parts[0]?.type === "text" ? parts[0].text : "";
};

export const steer_message = async (text: string, attachments: Attachment[], model: ModelEntry, read_image: ImageReader = fitted_image_url): Promise<ApiUserMessage> => ({
  role: "user",
  steer: true,
  content: await user_content(text ? `${steer_prefix}\n\n${text}` : steer_prefix, attachments, model, read_image),
});
