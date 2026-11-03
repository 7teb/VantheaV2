import type { Attachment, SteerMessage } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { SteerCheck } from "../hooks/turn-hooks.ts";
import { add_authorization } from "../permissions/context.ts";
import { refresh_instruction_snapshot } from "../permissions/instruction-files.ts";
import { note_images, type Describer } from "./vision-notes.ts";

export type SteerAdmission = {
  chat_id: string;
  model: ModelEntry;
  signal: AbortSignal;
  describe: Describer;
  check?: (steer: SteerMessage) => Promise<SteerCheck>;
};

export const admit_steer = async (admission: SteerAdmission, steer: SteerMessage): Promise<Attachment[]> => {
  const check = admission.check ? await admission.check(steer) : null;
  if (check && check.kind !== "passed") {
    return steer.attachments;
  }
  add_authorization(admission.chat_id, steer.id, steer.text, steer.assistant_reference, steer.attachments, steer.at);
  await refresh_instruction_snapshot(admission.chat_id);
  return note_images(steer.attachments, admission.model, admission.signal, admission.describe);
};
