import type { Translate } from "./translate.ts";

const minute = 60_000;

export const relative_time = (t: Translate, iso: string, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - Date.parse(iso)) / minute);
  if (minutes < 1) {
    return t("time.now");
  }
  if (minutes < 60) {
    return t("time.min", { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("time.hour", { n: hours });
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return t("time.day", { n: days });
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return t("time.week", { n: weeks });
  }
  return t("time.month", { n: Math.floor(days / 30) });
};
