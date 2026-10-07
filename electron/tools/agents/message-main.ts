import { max_main_messages } from "../../agents/runner.ts";
import { failed, guarded } from "../fs/common.ts";
import { define_tool } from "../types.ts";
import { read_text } from "./common.ts";

const message_chars = 4000;

export const message_main_agent_tool = define_tool<{ text: string }>({
  spec: {
    name: "message_main_agent",
    description: `Send a short message to the main agent while you keep working. It works in parallel and cannot see your transcript, so this is how it learns your results early and avoids redoing your work. Send one right away when something your task assumes turns out wrong (a named file, symbol or target is missing or elsewhere), when you have found the central answer while other parts remain, or when you are blocked; on longer tasks also after each finished stage, as a few lines of confirmed findings. Send results, not activity. It arrives at the start of the main agent's next round and you get no answer, so keep working afterwards. Your final report still arrives automatically. At most ${max_main_messages} messages per run.`,
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
  parse: (raw) => ({ text: read_text(raw, "text", message_chars) }),
  run: (ctx, args) =>
    guarded(ctx, "message_main_agent", async () => {
      if (!ctx.message_main) {
        return failed("Only a running sub-agent can message the main agent.");
      }
      if (!ctx.message_main(args.text)) {
        return failed(`No further messages can be sent from this run (the limit is ${max_main_messages}, or the run is stopping). Put the rest into your final report.`);
      }
      return {
        status: "done",
        text: "Sent to the main agent. It reads it at the start of its next round and does not answer. Keep working; your final report still arrives when you finish.",
        view: { kind: "text", text: args.text },
      };
    }),
});
