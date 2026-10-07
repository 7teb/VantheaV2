import { Skeleton } from "../../../components/Skeleton.tsx";
import { SettingsGroup } from "../SettingsLayout.tsx";

type PaneSkeletonProps = { rows: number[]; control?: number };

export const PaneSkeleton = ({ rows, control = 120 }: PaneSkeletonProps) => (
  <SettingsGroup>
    {rows.map((width, index) => (
      <div key={index} className="settings-row" aria-busy="true">
        <span className="pane-skeleton-text">
          <Skeleton width={width} height={13} radius={5} />
          <Skeleton width={Math.round(width * 1.6)} height={10} radius={4} />
        </span>
        <Skeleton width={control} height={28} radius={9} />
      </div>
    ))}
  </SettingsGroup>
);

type ListSkeletonProps = { rows: number[] };

export const ListSkeleton = ({ rows }: ListSkeletonProps) => (
  <>
    {rows.map((width, index) => (
      <div key={index} className="settings-row" aria-busy="true">
        <span className="pane-skeleton-text">
          <Skeleton width={`${width}%`} height={13} radius={5} />
          <Skeleton width={`${Math.round(width * 0.6)}%`} height={10} radius={4} />
        </span>
        <Skeleton width={26} height={26} radius={6} />
      </div>
    ))}
  </>
);
