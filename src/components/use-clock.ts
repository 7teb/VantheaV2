import { useEffect, useState } from "react";

export const use_clock = (ticking: boolean) => {
  const [now, set_now] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) {
      return;
    }
    set_now(Date.now());
    const timer = window.setInterval(() => set_now(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
};
