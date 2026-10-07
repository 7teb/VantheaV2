import { Skeleton, SkeletonBubble, SkeletonLines } from "../../components/Skeleton.tsx";

export const ChatSkeleton = () => (
  <div className="chat-slot" aria-busy="true">
    <div className="chat-column">
      <SkeletonBubble width="46%" height={44} />
      <div className="chat-skeleton-answer">
        <Skeleton width={128} height={12} radius={5} />
        <SkeletonLines widths={[94, 88, 71]} height={13} gap={12} />
        <Skeleton width="100%" height={132} radius={14} />
        <SkeletonLines widths={[82, 58]} height={13} gap={12} />
      </div>
      <SkeletonBubble width="34%" height={44} />
      <SkeletonLines widths={[90, 76, 84, 40]} height={13} gap={12} />
    </div>
  </div>
);
