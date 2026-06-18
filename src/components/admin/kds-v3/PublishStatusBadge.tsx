/**
 * KDS v3 phase 6.5 — publish-status pill.
 *
 * Reusable badge used in the edit page header + the screens list rows.
 * Amber "Unpublished changes" when draft != published; gray "Up to date"
 * otherwise. Includes a relative timestamp tooltip on hover so the
 * operator can see "last published 2 hours ago" without leaving the page.
 */
export interface PublishStatusBadgeProps {
  unpublished: boolean
  publishedAt: string | null
}

export function PublishStatusBadge({ unpublished, publishedAt }: PublishStatusBadgeProps) {
  const title = publishedAt
    ? `Last published: ${new Date(publishedAt).toLocaleString()}`
    : 'Never published'

  if (unpublished) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
        title={title}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Unpublished changes
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
      title={title}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" aria-hidden="true" />
      Up to date
    </span>
  )
}
