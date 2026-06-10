import { Spinner, CardSkeleton } from "@/components/Loading";

export default function AnalyticsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="flex items-center gap-3 pt-8 mb-3">
        <h1 className="text-xl sm:text-2xl font-black text-ink">アニメ分析</h1>
        <Spinner className="w-4 h-4" />
        <span className="text-xs text-muted font-medium">集計しています…</span>
      </div>
      <div className="border-b-2 border-line mb-6 h-10" />
      <div className="space-y-5">
        <CardSkeleton height="h-96" />
        <CardSkeleton height="h-80" />
        <CardSkeleton height="h-56" />
      </div>
    </div>
  );
}
