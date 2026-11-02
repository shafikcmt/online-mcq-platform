import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while a list page loads (same frame as the real page, so nothing jumps). */
export function ListSkeleton({ label, rows = 8 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-6" role="status" aria-label={label}>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Card>
        <div className="border-b border-line px-4 py-3">
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-4 w-24 md:block" />
              <Skeleton className="hidden h-4 w-20 md:block" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Rows placeholder inside a list card while the URL's page is being read. */
export function ListRowsLoading({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 md:block" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
