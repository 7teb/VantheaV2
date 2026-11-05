import { interval_ms, type ScheduledTaskView } from "../../../shared/scheduled.ts";
import type { Translate } from "../../i18n/translate.ts";

const day_ms = 86_400_000;

const hour_ms = 3_600_000;

const minute_ms = 60_000;

const locale_of = (language: string) => (language === "en" ? "en-GB" : language);

const local_day = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const formatted = (language: string, options: Intl.DateTimeFormatOptions, date: Date) =>
  new Intl.DateTimeFormat(locale_of(language), { ...options, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date)
    .map((part) => (part.type === "literal" ? part.value.replace(/,\s*/g, " ") : part.value))
    .join("");

export const clock_label = (iso: string, now: number, language: string): string => {
  const date = new Date(iso);
  const days = Math.round((local_day(date.getTime()) - local_day(now)) / day_ms);
  if (days === 0) {
    return formatted(language, {}, date);
  }
  if (Math.abs(days) <= 6) {
    return formatted(language, { weekday: "short" }, date);
  }
  return formatted(language, { day: "numeric", month: "short" }, date);
};

export const dial_text = (t: Translate, remaining_ms: number): string => {
  if (remaining_ms <= 0) {
    return t("scheduled.dial_now");
  }
  const minutes = Math.ceil(remaining_ms / minute_ms);
  if (minutes < 60) {
    return t("scheduled.dial_minutes", { n: minutes });
  }
  if (remaining_ms < day_ms) {
    return t("scheduled.dial_hours", { n: Math.max(1, Math.floor(remaining_ms / hour_ms)) });
  }
  return t("scheduled.dial_days", { n: Math.floor(remaining_ms / day_ms) });
};

export const dial_ratio = (task: Pick<ScheduledTaskView, "next_run_at" | "interval">, now: number): number =>
  Math.min(1, Math.max(0, 1 - (Date.parse(task.next_run_at) - now) / interval_ms[task.interval]));

export const soonest_id = (tasks: readonly ScheduledTaskView[]): string | null => {
  let soonest: ScheduledTaskView | null = null;
  for (const task of tasks) {
    if (!task.enabled || task.running) {
      continue;
    }
    if (soonest === null || Date.parse(task.next_run_at) < Date.parse(soonest.next_run_at)) {
      soonest = task;
    }
  }
  return soonest?.id ?? null;
};
