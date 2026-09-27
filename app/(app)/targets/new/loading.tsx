import { CardSkeleton, PageHeaderSkeleton } from "@/components/common/page-skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <PageHeaderSkeleton action={false} />
      <CardSkeleton rows={2} />
      <CardSkeleton rows={4} />
    </div>
  );
}
