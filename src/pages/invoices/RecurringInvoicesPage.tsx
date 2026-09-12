import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  subscribeToInvoices, generateNextInvoice, updateInvoice,
} from '../../services/invoiceService'
import {
  invoiceTotal, fmtCurrency, recurringState, recurringSummary,
  type Invoice, type RecurringInterval, type RecurringState,
} from '../../models/invoice'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'

const INTERVAL_LABELS: Record<RecurringInterval, string> = {
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  yearly:    'Yearly',
}

const INTERVAL_COLORS: Record<RecurringInterval, string> = {
  monthly:   'bg-blue-500/15 text-blue-300',
  quarterly: 'bg-violet-500/15 text-violet-300',
  yearly:    'bg-teal-500/15 text-teal-300',
}

/**
 * How each state reads. "Due" and "undated" were one thing before, so a
 * schedule with no date claimed to be due and showed "—" for when.
 */
const STATE_META: Record<RecurringState, {
  label: string | null
  chip: string
  /** A left edge, not a 5% wash — bg-orange-500/5 measured 1.07:1 on the card. */
  edge: string
}> = {
  due:       { label: 'Due now',     chip: 'bg-orange-500/20 text-orange-200 border border-orange-500/40', edge: 'border-l-4 border-l-orange-400' },
  undated:   { label: 'No date set', chip: 'bg-amber-500/20 text-amber-200 border border-amber-500/40',    edge: 'border-l-4 border-l-amber-400' },
  paused:    { label: 'Paused',      chip: 'bg-gray-600/40 text-gray-200 border border-gray-500/40',       edge: 'border-l-4 border-l-gray-500' },
  scheduled: { label: null,          chip: '',                                                             edge: 'border-l-4 border-l-transparent' },
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Sort: needs-attention first, then soonest. Paused sink to the bottom. */
const STATE_ORDER: Record<RecurringState, number> = { due: 0, undated: 1, scheduled: 2, paused: 3 }

export default function RecurringInvoicesPage() {
  usePageTitle('Recurring Invoices')
  const toast    = useToast()
  const navigate = useNavigate()

  const [invoices,   setInvoices]   = useState<Invoice[]>([])
  const [loading,    setLoading]    = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [working,    setWorking]    = useState<string | null>(null)
  const [confirmGenerate, setConfirmGenerate] = useState<Invoice | null>(null)
  const [confirmPause,    setConfirmPause]    = useState<Invoice | null>(null)

  useEffect(() => {
    return subscribeToInvoices(
      all => { setInvoices(all); setLoading(false) },
      ()  => setLoading(false),
    )
  }, [])

  const recurring = useMemo(() => {
    const list = invoices.filter(inv => !!inv.recurring)
    return list.sort((a, b) => {
      const byState = STATE_ORDER[recurringState(a)] - STATE_ORDER[recurringState(b)]
      if (byState !== 0) return byState
      return (a.nextRecurDate?.getTime() ?? 0) - (b.nextRecurDate?.getTime() ?? 0)
    })
  }, [invoices])

  const summary = useMemo(() => recurringSummary(recurring), [recurring])

  async function handleGenerate(inv: Invoice) {
    setConfirmGenerate(null)
    setGenerating(inv.id)
    try {
      const newId = await generateNextInvoice(inv)
      toast('Invoice created and marked sent — opening it now.', 'success')
      navigate(`/invoices/${newId}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to generate invoice', 'error')
      setGenerating(null)
    }
  }

  /**
   * A pause that can be undone.
   *
   * This used to write `{ recurring: null, nextRecurDate: null }` — destroying
   * the interval and the next date, dropping the row out of the list entirely,
   * and leaving no way back short of editing the invoice and rebuilding the
   * schedule by hand. The toast said "paused" regardless.
   */
  async function setPaused(inv: Invoice, paused: boolean) {
    setConfirmPause(null)
    setWorking(inv.id)
    try {
      await updateInvoice(inv.id, { recurringPaused: paused })
      toast(paused ? 'Schedule paused. Resume it any time.' : 'Schedule resumed.', 'success')
    } catch {
      toast(paused ? 'Failed to pause schedule' : 'Failed to resume schedule', 'error')
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Recurring invoices</h1>
          {/* Was text-gray-500. Also says how these get issued: a daily cron
              generates them whether or not anyone opens this page, and
              nothing here mentioned that. */}
          <p className="text-sm text-gray-400 mt-0.5">
            Issued automatically each morning, or on demand below
          </p>
        </div>
        <Link to="/invoices/new" className="btn-primary text-sm px-4 py-2 shrink-0">
          + New invoice
        </Link>
      </div>

      {/* The number the page is for, which it never showed: every row had an
          amount and an interval, and the header reported only a count. */}
      {!loading && recurring.length > 0 && (
        <div className="card p-4 mb-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Committed revenue</p>
              <p className="text-2xl font-bold text-white mt-1 tabular-nums">
                {fmtCurrency(summary.monthly)}<span className="text-sm font-medium text-gray-400"> / month</span>
              </p>
              <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
                {fmtCurrency(summary.annual)} a year across {summary.active} active schedule{summary.active !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(Object.keys(INTERVAL_LABELS) as RecurringInterval[])
                .filter(i => summary.byInterval[i] > 0)
                .map(i => (
                  <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${INTERVAL_COLORS[i]}`}>
                    {summary.byInterval[i]} {INTERVAL_LABELS[i].toLowerCase()}
                  </span>
                ))}
              {summary.paused > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-600/40 text-gray-200">
                  {summary.paused} paused
                </span>
              )}
            </div>
          </div>
          {(summary.due > 0 || summary.undated > 0) && (
            <p className="text-xs mt-3 pt-3 border-t border-gray-700/50 flex items-center gap-1.5">
              <Icon d={ICONS.warning} className="w-3.5 h-3.5 shrink-0 text-orange-300" />
              <span className="text-gray-200">
                {summary.due > 0 && <>{summary.due} ready to issue</>}
                {summary.due > 0 && summary.undated > 0 && ' · '}
                {summary.undated > 0 && <>{summary.undated} with no next date</>}
              </span>
            </p>
          )}
        </div>
      )}

      {loading ? (
        /* Two lines totalling 68px against a card that measures ~136px —
           exactly half, so three placeholders jumped the page by 204px. */
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 animate-pulse border-l-4 border-l-transparent">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-36 bg-gray-700 rounded" />
                    <div className="h-4 w-16 bg-gray-700/60 rounded-full" />
                  </div>
                  <div className="h-6 w-24 bg-gray-700 rounded" />
                  <div className="h-3 w-56 bg-gray-700/60 rounded" />
                  <div className="h-3 w-40 bg-gray-700/60 rounded" />
                </div>
                <div className="space-y-1.5 shrink-0">
                  <div className="h-7 w-24 bg-gray-700 rounded-lg" />
                  <div className="h-6 w-20 bg-gray-700/60 rounded" />
                  <div className="h-6 w-14 bg-gray-700/60 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : recurring.length === 0 ? (
        <div className="card p-12 text-center">
          {/* Was a raw ↻ glyph at text-4xl. */}
          <Icon d={ICONS.refresh} className="w-9 h-9 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-200 font-medium mb-1">No recurring invoices yet</p>
          <p className="text-sm text-gray-400 mb-4">
            Open any invoice, choose Edit, and turn on &ldquo;Recurring invoice&rdquo; to set a schedule.
          </p>
          <Link to="/invoices" className="btn-secondary text-sm px-4 py-2">
            View all invoices
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {recurring.map(inv => {
            const state    = recurringState(inv)
            const meta     = STATE_META[state]
            const total    = invoiceTotal(inv)
            const interval = inv.recurring!
            const paused   = state === 'paused'
            const busy     = working === inv.id
            const items    = inv.lineItems.map(l => l.description).filter(Boolean).join(' · ')

            return (
              <div
                key={inv.id}
                /* The state now reads off a solid left edge. The old
                   bg-orange-500/5 wash was 1.07:1 against the card and its
                   border-orange-500/30 was 1.57:1 — neither was visible. */
                className={`card p-4 ${meta.edge} ${paused ? 'opacity-75' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">

                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {/* The row had no way to open the template — only an
                          Edit link straight into the form. */}
                      <Link
                        to={`/invoices/${inv.id}`}
                        className="font-semibold text-white hover:text-indigo-300 transition-colors rounded
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        {inv.customerName || 'Unnamed customer'}
                      </Link>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INTERVAL_COLORS[interval]}`}>
                        {INTERVAL_LABELS[interval]}
                      </span>
                      {meta.label && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.chip}`}>
                          {meta.label}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="text-lg font-bold text-white tabular-nums">{fmtCurrency(total, inv.currency)}</span>
                      <span className="text-xs text-gray-400 font-mono">{inv.invoiceNumber}</span>
                    </div>

                    {/* Was text-gray-500 at 3.04:1. */}
                    <div className="flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-gray-400">
                      <span>
                        Next:{' '}
                        <span className={`font-medium ${
                          state === 'due' ? 'text-orange-300'
                          : state === 'undated' ? 'text-amber-300'
                          : 'text-gray-200'
                        }`}>
                          {state === 'undated' ? 'not set' : fmtDate(inv.nextRecurDate)}
                        </span>
                      </span>
                      <span>
                        Last issued: <span className="text-gray-200">{fmtDate(inv.lastGeneratedAt)}</span>
                      </span>
                    </div>

                    {/* Was text-gray-600 — 1.94:1 — for the only text on the
                        page saying what is actually being billed. */}
                    {items && (
                      <p className="text-xs text-gray-300 mt-1.5 line-clamp-1" title={items}>
                        {items}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0 items-stretch">
                    {paused ? (
                      <button
                        onClick={() => void setPaused(inv, false)}
                        disabled={busy}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40
                                   bg-indigo-600 hover:bg-indigo-500 text-white
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        {busy ? 'Resuming…' : 'Resume'}
                      </button>
                    ) : (
                      <>
                        {/* Only this row's button disables: it was
                            `disabled={!!generating}`, so starting one greyed
                            out every row on the page. */}
                        <button
                          onClick={() => setConfirmGenerate(inv)}
                          disabled={generating === inv.id}
                          /* orange-700: white on it is 5.18:1, against 3.56
                             on 600 and 2.80 on 500. index.css pinned
                             .bg-orange-500 to true white in light mode, so
                             the rescue was holding the old button at 2.80
                             there rather than fixing it; 700 is added to that
                             list so white survives in both themes. */
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40
                                      focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                            state === 'due'
                              ? 'bg-orange-700 hover:bg-orange-600 text-white'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                        >
                          {generating === inv.id ? 'Generating…' : 'Issue now'}
                        </button>
                        <button
                          onClick={() => setConfirmPause(inv)}
                          disabled={busy}
                          className="text-xs text-gray-300 hover:text-white transition-colors px-2 py-1 rounded
                                     hover:bg-gray-700 disabled:opacity-40
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          {busy ? 'Pausing…' : 'Pause'}
                        </button>
                      </>
                    )}
                    <Link
                      to={`/invoices/${inv.id}/edit`}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded
                                 hover:bg-gray-700 text-center
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Edit template
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* "Issue now" creates a real invoice marked sent and advances the
          schedule, and had no confirmation at all — one click, then it
          navigated away. */}
      <ConfirmModal
        isOpen={!!confirmGenerate}
        message={confirmGenerate
          ? `Issue an invoice for ${fmtCurrency(invoiceTotal(confirmGenerate), confirmGenerate.currency)} to ${confirmGenerate.customerName || 'this customer'}? It is created marked sent, and the schedule moves to its next ${INTERVAL_LABELS[confirmGenerate.recurring!].toLowerCase()} date.`
          : ''}
        confirmLabel="Issue invoice"
        onConfirm={() => { if (confirmGenerate) void handleGenerate(confirmGenerate) }}
        onCancel={() => setConfirmGenerate(null)}
      />

      <ConfirmModal
        isOpen={!!confirmPause}
        message={confirmPause
          ? `Pause the ${INTERVAL_LABELS[confirmPause.recurring!].toLowerCase()} schedule for ${confirmPause.customerName || 'this customer'}? No invoices will be issued, automatically or by hand, until you resume it. The schedule and its next date are kept.`
          : ''}
        confirmLabel="Pause schedule"
        onConfirm={() => { if (confirmPause) void setPaused(confirmPause, true) }}
        onCancel={() => setConfirmPause(null)}
      />
    </div>
  )
}
