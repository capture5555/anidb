"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  REGION_KEYS,
  REGION_LABELS,
  REGION_COOKIE,
  parseRegion,
  type Region,
} from "@/lib/regions";

/**
 * 放送地域の切り替え（TOPの「この後の放送」用）。
 * Cookieに保存し、サーバーコンポーネントを再取得（router.refresh）して反映する。
 */
export function RegionSelector({ initial }: { initial: Region }) {
  const router = useRouter();
  const [region, setRegion] = useState<Region>(initial);
  const [pending, startTransition] = useTransition();

  const change = (value: string) => {
    const r = parseRegion(value);
    setRegion(r);
    document.cookie = `${REGION_COOKIE}=${r}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="font-bold">地域</span>
      <select
        value={region}
        onChange={(e) => change(e.target.value)}
        disabled={pending}
        className="bg-surface border border-line rounded-md px-2 py-1 text-xs font-medium text-ink-soft focus:outline-none focus:border-primary disabled:opacity-50"
      >
        {REGION_KEYS.map((r) => (
          <option key={r} value={r}>
            {REGION_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}
