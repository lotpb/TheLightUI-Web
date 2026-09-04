import { useState, type ReactNode } from 'react'

/**
 * A titled disclosure for content that's useful but isn't why you opened the
 * page — reference lists, breakdown charts, analysis panels.
 *
 * Extracted from DashboardPage, where fourteen sections were all peers so
 * period figures, pipeline health and browsable record lists competed for the
 * same attention. /expenses had the same shape: three summary charts stacked
 * above the expense list, so you scrolled past every visualisation to reach
 * the data the page is named after.
 *
 * Defaults closed and the state isn't persisted, deliberately — the page should
 * always open showing its primary content, not whatever was expanded last time.
 */
export default function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string
  /** Optional figure beside the title, e.g. how many rows are inside. */
  count?: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 py-2 text-left group"
      >
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
        <p className="section-header mb-0 group-hover:text-gray-200 transition-colors">{title}</p>
        {count !== undefined && count > 0 && (
          <span className="text-xs font-semibold text-gray-400 tabular-nums">{count}</span>
        )}
      </button>
      {open && <div className="space-y-4 pt-2">{children}</div>}
    </section>
  )
}
