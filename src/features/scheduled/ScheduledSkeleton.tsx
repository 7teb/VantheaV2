import { Skeleton } from "../../components/Skeleton.tsx";

const cards = [
  { name: 34, prompt: [88, 56] },
  { name: 48, prompt: [72, 64] },
  { name: 40, prompt: [80] },
];

export const ScheduledSkeleton = () => (
  <div className="scheduled-list" aria-busy="true">
    {cards.map((card, index) => (
      <div key={index} className="scheduled-card raised-surface is-skeleton" aria-hidden="true">
        <Skeleton className="scheduled-skeleton-dial" width={40} height={40} radius="var(--radius-full)" />
        <div className="scheduled-card-head">
          <Skeleton width={`${card.name}%`} height={12} radius={5} />
        </div>
        <div className="scheduled-body">
          {card.prompt.map((width) => (
            <Skeleton key={width} width={`${width}%`} height={12} radius={5} />
          ))}
          <Skeleton className="scheduled-skeleton-meta" width="30%" height={10} radius={5} />
        </div>
        <div className="scheduled-foot">
          <Skeleton width={81} height={14} radius={4} />
          <Skeleton width={110} height={12} radius={5} />
          <Skeleton width={64} height={12} radius={5} />
        </div>
      </div>
    ))}
  </div>
);
