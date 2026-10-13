import type { Attachment, Message, UserMessage } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";

export type Describer = (attachment_id: string, signal: AbortSignal) => Promise<string>;

const noted = async (attachment: Attachment, signal: AbortSignal, describe: Describer): Promise<Attachment> => {
  if (attachment.kind !== "image" || attachment.vision_note) {
    return attachment;
  }
  try {
    return { ...attachment, vision_note: await describe(attachment.model?.id ?? attachment.id, signal) };
  } catch (error) {
    console.error(`[turn] the vision note for attachment ${attachment.id} (${attachment.name}) failed:`, error);
    return attachment;
  }
};

export const note_images = async (attachments: Attachment[], model: ModelEntry, signal: AbortSignal, describe: Describer): Promise<Attachment[]> =>
  model.vision ? attachments : Promise.all(attachments.map((attachment) => noted(attachment, signal, describe)));

export const note_newest_user = async (messages: Message[], model: ModelEntry, signal: AbortSignal, describe: Describer, save: (message: UserMessage) => void): Promise<Message[]> => {
  const index = messages.findLastIndex((message) => message.role === "user");
  const user = messages[index];
  if (model.vision || user?.role !== "user" || !user.attachments.some((attachment) => attachment.kind === "image" && !attachment.vision_note)) {
    return messages;
  }
  const described: UserMessage = { ...user, attachments: await note_images(user.attachments, model, signal, describe) };
  signal.throwIfAborted();
  save(described);
  return messages.with(index, described);
};
