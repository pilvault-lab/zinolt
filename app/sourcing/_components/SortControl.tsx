"use client";

import { useRouter } from "next/navigation";

export type QueueSort = "views" | "likes";

export const SortControl: React.FC<{ current: QueueSort }> = ({ current }) => {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-ds-on-surface-muted">
      <span>Sort by</span>
      <select
        value={current}
        onChange={(e) => router.push(`/sourcing?sort=${e.target.value}`)}
        className="rounded-md border border-ds-border-hairline bg-ds-surface-raised px-2 py-1 text-ds-on-surface"
      >
        <option value="views">Views</option>
        <option value="likes">Likes</option>
      </select>
    </label>
  );
};
