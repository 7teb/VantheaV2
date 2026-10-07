import type { time as en } from "../en/time.ts";

export const time: Record<keyof typeof en, string> = {
  "time.now": "jetzt",
  "time.min": "{n} Min.",
  "time.hour": "{n} Std.",
  "time.day": "{n} Tag(e)",
  "time.week": "{n} W",
  "time.month": "{n} M",
};
