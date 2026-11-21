/** Red circle with a number, placed on the top-right corner of a `relative` parent. */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-label={`${count} do sprawdzenia`}
      className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold leading-none text-white ring-2 ring-white dark:ring-[var(--background)]"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
