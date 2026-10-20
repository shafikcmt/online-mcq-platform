import { Skeleton } from "@/components/ui/skeleton";

export function FormSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" role="status" aria-label={label}>
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-8 w-64" />
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-4 rounded-card border border-line bg-surface p-5">
          <Skeleton className="h-5 w-40" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
