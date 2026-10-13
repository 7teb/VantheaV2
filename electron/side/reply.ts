export type SideReply = { text: string; finish_reason: string | null };

export const output_cut_note = "(The provider stopped this output at its output length limit, so it is incomplete.)";

export const noted_text = (reply: SideReply): string => (reply.finish_reason === "length" ? `${reply.text}\n${output_cut_note}` : reply.text);
