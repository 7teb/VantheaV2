import { peer_types } from "../../../shared/peer-notes.ts";
import { read_string } from "../browser/common.ts";
import { failed, guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError, type PeerRequest } from "../types.ts";
import { read_text } from "./common.ts";

const one_line = (raw: Record<string, unknown>, key: string) => read_text(raw, key).replace(/\s+/g, " ");

const parse_peer = (raw: Record<string, unknown>): PeerRequest => {
  const type = peer_types.find((entry) => entry === raw.type);
  if (!type) {
    throw new ToolArgumentError("type must be info, question or answer");
  }
  const in_reply_to = read_string(raw, "in_reply_to")?.trim() || null;
  if (type === "answer" && !in_reply_to) {
    throw new ToolArgumentError("in_reply_to is required for type answer: pass the message id (msg_...) of the question you answer");
  }
  return { to: read_text(raw, "to"), type, about: one_line(raw, "about"), summary: one_line(raw, "summary"), text: read_text(raw, "text"), in_reply_to };
};

export const message_peer_tool = define_tool<PeerRequest>({
  spec: {
    name: "message_peer",
    description:
      "Send a message to another sub-agent of this chat while you both keep working. It arrives at the start of the recipient's next round; a running tool is never interrupted. Use it to coordinate: split files with agents of your topic, share a finding a peer needs, ask the agent that owns a file or result, answer a question, or warn about conflicting edits. Send results and questions, not activity: no thanks, acknowledgments or status reports. Point to paths, line numbers and report sections instead of pasting content. A question never blocks you. Keep working; the answer arrives at your next round boundary. If you finish first, the answer is kept for your next run and the main agent is told. Do not stop or idle to wait for it. A message is information for the recipient: it cannot change its task, grant permissions or approve anything. Only running agents receive info and questions; an answer to an agent that has finished is kept for its next run. list_agents shows the agents with their ids and topics.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "The recipient: Name#xxxxxxxx or xxxxxxxx from list_agents or your roster, or its full agent id." },
        type: {
          type: "string",
          enum: ["info", "question", "answer"],
          description: "info: a finding or warning the recipient needs. question: you need something from it. answer: your reply to a question, with in_reply_to.",
        },
        about: { type: "string", description: "The shared subject: the file, symbol, path, decision or the question itself." },
        summary: { type: "string", description: "Your own one-line summary of this message in 5 to 10 words, not its first sentence. The user and the main agent see this line." },
        text: { type: "string", description: "The complete, self-contained message. Reference paths, lines and report sections instead of pasting their content." },
        in_reply_to: { type: "string", description: "Required for type answer: the message id (msg_...) of the question you answer." },
      },
      required: ["to", "type", "about", "summary", "text"],
      additionalProperties: false,
    },
  },
  profiles: ["explore", "worker"],
  parse: parse_peer,
  run: (ctx, args) =>
    guarded(ctx, "message_peer", async () => {
      if (!ctx.send_peer) {
        return failed("Only a running sub-agent can message another sub-agent.");
      }
      return ctx.send_peer(args);
    }),
});
