import { failed, guarded } from "../fs/common.ts";
import { define_tool } from "../types.ts";
import { read_text } from "./common.ts";

export const message_main_agent_tool = define_tool<{ text: string }>({
  spec: {
    name: "message_main_agent",
    description:
      "Send a short message to the main agent while you keep working. It works in parallel and cannot see your transcript, so this is how it learns your findings early and avoids redoing your work. Send one as soon as you know something it can use: right away when something your task assumes turns out wrong (a named file, symbol or target is missing or elsewhere), when you are blocked, and when you have found a cause or the central answer, before you start fixing it. On longer tasks send what you confirmed since your last message: where something lives, what causes a behavior, what you ruled out and why. Which files you edited, which commands you ran or that you are done is not a finding; your final report carries that, so mention an edit or a test result only when it changes what the main agent does next. It arrives at the start of the main agent's next round and you get no answer, so keep working afterwards. Your final report still arrives automatically.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Self-contained message with the concrete finding, paths and identifiers; the main agent does not see your transcript." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  profiles: ["explore", "worker"],
  parse: (raw) => ({ text: read_text(raw, "text") }),
  run: (ctx, args) =>
    guarded(ctx, "message_main_agent", async () => {
      if (!ctx.message_main) {
        return failed("Only a running sub-agent can message the main agent.");
      }
      if (!ctx.message_main(args.text)) {
        return failed("This run is stopping, so the message was not sent. Put it into your final report.");
      }
      return {
        status: "done",
        text: "Sent to the main agent. It reads it at the start of its next round and does not answer. Keep working; your final report still arrives when you finish.",
        view: { kind: "text", text: args.text },
      };
    }),
});
