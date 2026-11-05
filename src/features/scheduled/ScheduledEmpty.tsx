import { Button } from "../../components/Button.tsx";
import { CalendarClockIcon, PlusIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import "./ScheduledEmpty.css";

const ticks = Array.from({ length: 60 }, (_, index) => {
  const angle = (index * Math.PI) / 30;
  const major = index % 5 === 0;
  const point = (radius: number) => ({ x: (60 + Math.sin(angle) * radius).toFixed(2), y: (60 - Math.cos(angle) * radius).toFixed(2) });
  return { index, major, from: point(major ? 50 : 53), to: point(56) };
});

const EmptyDial = () => (
  <div className="empty-dial">
    <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <g className="empty-ticks">
        {ticks.map((tick) => (
          <line key={tick.index} className={tick.major ? "is-major" : undefined} x1={tick.from.x} y1={tick.from.y} x2={tick.to.x} y2={tick.to.y} />
        ))}
      </g>
      <circle className="empty-track" cx="60" cy="60" r="42" />
      <g className="empty-sweep-group">
        <circle className="empty-sweep" cx="60" cy="60" r="42" transform="rotate(-90 60 60)" />
      </g>
    </svg>
    <CalendarClockIcon size={32} />
  </div>
);

export const ScheduledEmpty = ({ on_create }: { on_create: () => void }) => {
  const t = use_t();
  return (
    <div className="scheduled-empty">
      <EmptyDial />
      <h2 className="scheduled-empty-title">{t("scheduled.empty")}</h2>
      <Button icon={<PlusIcon />} onClick={on_create}>
        {t("scheduled.new")}
      </Button>
    </div>
  );
};
