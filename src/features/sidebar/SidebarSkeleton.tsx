import { Skeleton, SkeletonRows } from "../../components/Skeleton.tsx";

const groups = [
  { label: 52, rows: [74, 58] },
  { label: 64, rows: [82, 66, 78, 54] },
  { label: 88, rows: [60, 72, 50] },
];

export const SidebarSkeleton = () => (
  <div className="sidebar-sections" aria-busy="true">
    {groups.map((group, index) => (
      <div key={index} className="sidebar-section">
        <div className="sidebar-section-head">
          <Skeleton width={group.label} height={9} radius={4} />
        </div>
        <SkeletonRows widths={group.rows} />
      </div>
    ))}
  </div>
);
