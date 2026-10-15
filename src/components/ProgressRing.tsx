import { class_names } from "./class-names.ts";
import "./ProgressRing.css";

type ProgressRingProps = { ratio: number; size: number; className?: string };

export const ProgressRing = ({ ratio, size, className }: ProgressRingProps) => {
  const center = size / 2;
  const radius = center - 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className={class_names("progress-ring", className)} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="progress-ring-track" cx={center} cy={center} r={radius} />
      <circle
        className="progress-ring-value"
        cx={center}
        cy={center}
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
};
