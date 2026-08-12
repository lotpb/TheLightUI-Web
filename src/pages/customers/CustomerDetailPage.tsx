import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getCustomer, deleteCustomer, deactivateCustomer, updateCustomer, setFollowUpDate } from '../../services/customerService'
import { fullName, formatCurrency, CATEGORY_LABELS, type CustomerItem, type CustomerCategory } from '../../models/customer'
import { printCustomer, downloadICS, downloadVCF } from '../../utils/exportUtils'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import { useNavBack } from '../../hooks/useNavBack'
import { usePageTitle } from '../../hooks/usePageTitle'
import { avatarColor, AVATAR_ORIGINAL } from '../../utils/avatarColor'
import { usePickerStore } from '../../stores/pickerStore'
import { usePrefStore } from '../../stores/prefStore'
import { useAuthStore } from '../../stores/authStore'
import { subscribeToActivities, addActivity, deleteActivity } from '../../services/activityService'
import { ACTIVITY_TYPES, type Activity, type ActivityType } from '../../models/activity'
import { subscribeToDocuments, uploadDocument, deleteDocument } from '../../services/documentService'
import { formatFileSize, fileIcon, type CustomerDocument } from '../../models/document'
import { updateTags } from '../../services/customerService'
import { tagColor } from '../../utils/tagColor'
import { scoreLead } from '../../utils/leadScore'

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navBack  = useNavBack('/records')
  const toast = useToast()
  const [customer, setCustomer] = useState<CustomerItem | null>(null)
  usePageTitle(customer ? fullName(customer) : '')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [compose, setCompose] = useState<'email' | 'sms' | null>(null)

  useEffect(() => {
    if (!id) return
    getCustomer(id)
      .then(c => { setCustomer(c); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  async function handleDelete() {
    if (!id || !customer) return
    setConfirmOpen(false)
    setDeleting(true)
    try {
      await deleteCustomer(id)
      navBack()
    } finally {
      setDeleting(false)
    }
  }

  async function handleToggleActive() {
    if (!id || !customer) return
    if (customer.isActive) {
      await deactivateCustomer(id)
      setCustomer({ ...customer, isActive: false })
    } else {
      await updateCustomer(id, { ...customer, isActive: true })
      setCustomer({ ...customer, isActive: true })
    }
  }

  const labels = usePickerStore(s => s.labels)
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)

  if (loading) return <LoadingSkeleton />

  if (!customer) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-400">Record not found.</p>
        <button onClick={navBack} className="mt-4 text-indigo-400 hover:text-indigo-300">← Go back</button>
      </div>
    )
  }

  const name = fullName(customer)
  const catLabel = customer.category
    ? (CATEGORY_LABELS[customer.category as CustomerCategory] ?? customer.category)
    : ''

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={navBack} className="text-indigo-400 hover:text-indigo-300 text-sm">
          ← Back
        </button>
        <div className="flex gap-2">
          <Link to={`/records/${id}/edit`} className="btn-secondary text-sm px-3 py-1.5">Edit</Link>
          <button onClick={() => setConfirmOpen(true)} disabled={deleting} className="btn-danger text-sm px-3 py-1.5">
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Header card */}
      <div className="card p-6 mb-4">
        {/* Row 1: table layout — avatar | name+lastname | amount trailing */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px' }}>
          <tbody>
            <tr>
              <td style={{ width: '56px', verticalAlign: 'top', padding: 0 }}>
                {customer.photo ? (
                  <img src={customer.photo} alt={name} style={{ width: '56px', height: '56px', borderRadius: '9999px', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ width: '56px', height: '56px', borderRadius: '9999px', background: (coloredAvatars ? avatarColor(name) : AVATAR_ORIGINAL).bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '18px', fontWeight: 700, color: (coloredAvatars ? avatarColor(name) : AVATAR_ORIGINAL).text }}>
                      {[customer.first[0], customer.lastname[0]].filter(Boolean).join('').toUpperCase() || '?'}
                    </span>
                  </div>
                )}
              </td>
              <td style={{ verticalAlign: 'top', paddingLeft: '16px', overflow: 'hidden' }}>
                {/* Desktop: first + last on one line (vendors: first only) */}
                <h1 className="hidden sm:block" style={{ fontSize: '22px', fontWeight: 700, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                  {customer.category.toLowerCase() === 'vendor'
                    ? customer.first || '—'
                    : [customer.first, customer.lastname].filter(Boolean).join(' ') || '—'}
                </h1>
                {customer.category.toLowerCase() === 'vendor' && customer.lastname && (
                  <p style={{ fontSize: '18px', fontWeight: 600, color: 'rgb(156,163,175)', margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.lastname}</p>
                )}
                {/* Mobile: two lines (vendors: first only) */}
                <div className="sm:hidden">
                  <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{customer.first || '—'}</h1>
                  {customer.category.toLowerCase() !== 'vendor' && customer.lastname && (
                    <p style={{ fontSize: '22px', fontWeight: 700, color: 'white', margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.lastname}</p>
                  )}
                </div>
              </td>
              <td style={{ verticalAlign: 'top', paddingLeft: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {customer.amount > 0 && (
                  <span style={{ fontSize: '20px', fontWeight: 700, color: 'rgb(74,222,128)' }}>{formatCurrency(customer.amount)}</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Row 3: status badges — flex-nowrap + shrink-0 keeps all on one line */}
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: '6px', marginBottom: '1.25rem' }}>
          {catLabel && (
            <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, fontSize: '11px', fontWeight: 500, background: 'rgba(67,56,202,0.3)', color: 'rgb(165,180,252)', padding: '3px 8px', borderRadius: '9999px', whiteSpace: 'nowrap' }}>
              {catLabel}
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, fontSize: '11px', fontWeight: 500, padding: '3px 8px', borderRadius: '9999px', whiteSpace: 'nowrap', background: customer.isActive ? 'rgba(21,128,61,0.2)' : 'rgba(55,65,81,0.4)', color: customer.isActive ? 'rgb(74,222,128)' : 'rgb(156,163,175)' }}>
            {customer.isActive ? 'Active' : 'Inactive'}
          </span>
          {customer.rate && (
            <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, fontSize: '11px', fontWeight: 500, background: 'rgba(161,98,7,0.2)', color: 'rgb(250,204,21)', padding: '3px 8px', borderRadius: '9999px', whiteSpace: 'nowrap' }}>
              ★ {customer.rate}
            </span>
          )}
          {(customer.category.toLowerCase() === 'vendor' ? customer.salesman : customer.callback).toLowerCase() === 'yes' && (
            <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: '3px', fontSize: '11px', fontWeight: 500, background: 'rgba(21,128,61,0.2)', color: 'rgb(74,222,128)', padding: '3px 8px', borderRadius: '9999px', whiteSpace: 'nowrap' }}>
              <svg style={{ width: '11px', height: '11px', flexShrink: 0, fill: 'currentColor' }} viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
              Called
            </span>
          )}
        </div>

        {/* Action button bar — matches iOS LeadDetailUI action menu */}
        <div className="flex gap-3 mt-5 pt-4 border-t border-gray-700/50 overflow-x-auto pb-1">
          {customer.phone && (
            <ActionTile
              href={`tel:${customer.phone}`}
              icon="📞"
              label="Call"
            />
          )}
          {customer.phone && (
            <ActionTile
              onClick={() => setCompose('sms')}
              icon="💬"
              label="Message"
            />
          )}
          {customer.email && (
            <ActionTile
              onClick={() => setCompose('email')}
              icon="✉️"
              label="Email"
            />
          )}
          {customer.street && (
            <ActionTile
              to={`/maps?address=${encodeURIComponent(
                [customer.street, customer.city, customer.state, customer.zip]
                  .filter(Boolean).join(', ')
              )}`}
              icon="🗺️"
              label="Map"
            />
          )}
          <ActionTile
            onClick={handleToggleActive}
            icon={customer.isActive ? '⭐' : '☆'}
            label={customer.isActive ? 'Following' : 'Follow'}
            active={customer.isActive}
          />
          <ActionTile
            onClick={() => downloadVCF(customer)}
            icon="👤"
            label="Contact"
          />
          {customer.startDate && !isNaN(customer.startDate.getTime()) && customer.startDate.getTime() > 0 && (
            <ActionTile
              onClick={() => downloadICS(customer)}
              icon="📅"
              label="Calendar"
            />
          )}
          <ActionTile
            onClick={() => printCustomer(customer, msg => toast(msg, 'error'))}
            icon="🖨️"
            label="Print"
          />
          <ActionTile
            to={`/records/${id}/quote`}
            icon="📋"
            label="Quote"
          />
          <ActionTile
            to={`/invoices/new?customerId=${id}`}
            icon="🧾"
            label="Invoice"
          />
        </div>
      </div>

      {/* Tags + Score */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <TagsSection
            customerId={id!}
            tags={customer.tags ?? []}
            allTags={[]}
            onUpdate={tags => setCustomer({ ...customer, tags })}
          />
        </div>
        {(customer.category.toLowerCase() === 'lead') && (
          <ScoreBadge customer={customer} />
        )}
      </div>

      {/* Detail fields */}
      <div className="space-y-4">
        <FieldGroup title="Contact">
          <Field label="Phone"    value={customer.phone} />
          <Field label="Email"    value={customer.email || '—'} />
          {customer.category.toLowerCase() !== 'employee' && (
            <Field
              label={customer.category.toLowerCase() === 'customer' ? 'Spouse' : 'Web Page'}
              value={customer.spouse}
            />
          )}
          {customer.category.toLowerCase() !== 'vendor' && (
            <div className="flex items-baseline px-4 py-3 gap-4">
              <span className="text-sm text-gray-500 w-28 shrink-0">Called</span>
              <span className="text-base flex-1 flex items-center gap-1.5">
                <svg className={`w-4 h-4 fill-current shrink-0 ${customer.callback.toLowerCase() === 'yes' ? 'text-green-400' : 'text-gray-500'}`} viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                <span className={customer.callback.toLowerCase() === 'yes' ? 'text-white' : 'text-gray-500'}>
                  {customer.callback.toLowerCase() === 'yes' ? 'Yes' : 'No'}
                </span>
              </span>
            </div>
          )}
        </FieldGroup>

        <FieldGroup title="Address">
          <Field label="Street"  value={customer.street} />
          <Field label="City"    value={customer.city} />
          <Field label="State"   value={customer.state} />
          <Field label="ZIP"     value={customer.zip} />
        </FieldGroup>

        <FieldGroup title={customer.category.toLowerCase() === 'employee' ? 'Employee Info' : 'Job Info'}>
          {customer.category.toLowerCase() !== 'vendor' && (
            <Field label={labels.salesman} value={customer.salesman} />
          )}
          {customer.category.toLowerCase() !== 'employee' && (
            <>
              {customer.category.toLowerCase() === 'vendor' && (
                <>
                  <Field label="Profession" value={customer.lastname || '—'} />
                  <div className="flex items-baseline px-4 py-3 gap-4">
                    <span className="text-sm text-gray-500 w-28 shrink-0">Called</span>
                    <span className="text-base flex-1 flex items-center gap-1.5">
                      <svg className={`w-4 h-4 fill-current shrink-0 ${customer.salesman.toLowerCase() === 'yes' ? 'text-green-400' : 'text-gray-500'}`} viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                      <span className={customer.salesman.toLowerCase() === 'yes' ? 'text-white' : 'text-gray-500'}>
                        {customer.salesman.toLowerCase() === 'yes' ? 'Yes' : 'No'}
                      </span>
                    </span>
                  </div>
                  <Field label="Manager" value={customer.callback || '—'} />
                </>
              )}
              {customer.category.toLowerCase() === 'customer' && (
                <Field label={labels.contractor} value={customer.contractor || '—'} />
              )}
            </>
          )}
          <Field label={labels.job}     value={customer.job} />
          <Field label={labels.product} value={customer.product} />
          <Field label="Quantity"   value={customer.quantity > 0 ? String(customer.quantity) : ''} />
          <Field
            label={customer.category.toLowerCase() === 'employee' ? 'Department' : labels.advertiser}
            value={customer.adNo}
          />
          {customer.category.toLowerCase() === 'employee' && (
            <Field label="Rating" value={customer.rate} />
          )}
        </FieldGroup>

        {customer.category.toLowerCase() === 'lead' && (
          <FieldGroup title="Personal">
            <Field label="Spouse" value={customer.spouse} />
          </FieldGroup>
        )}
        {customer.category.toLowerCase() === 'employee' && (
          <FieldGroup title="Personal">
            <SsnField value={customer.spouse} />
            <Field label="Driver License"  value={customer.driverLicense} />
          </FieldGroup>
        )}

        <FieldGroup title="Dates">
          {customer.category.toLowerCase() === 'lead' && (
            <Field label="Apt Date" value={formatDate(customer.startDate)} />
          )}
          {customer.category.toLowerCase() === 'employee' && (
            <>
              <Field label="Start Date" value={formatDate(customer.startDate)      || '—'} />
              <Field label="End Date"   value={formatDate(customer.completionDate) || '—'} />
            </>
          )}
          {customer.category.toLowerCase() === 'customer' && (
            <>
              <Field label="Start Date"  value={formatDate(customer.startDate)} />
              <Field label="Complete"    value={formatDate(customer.completionDate)} />
            </>
          )}
          <Field label="Date Added"  value={formatDate(customer.creationDate)  || '—'} />
          <Field label="Last Update" value={formatDate(customer.lastUpdateDate) || '—'} />
          {customer.category.toLowerCase() === 'employee' && (
            <Field label="Birth Date" value={customer.birthDate} />
          )}
        </FieldGroup>

        <FollowUpSection
          customerId={id!}
          followUpDate={customer.followUpDate}
          onUpdate={date => setCustomer({ ...customer, followUpDate: date })}
        />
        <NotesSection
          customer={customer}
          onUpdate={comments => setCustomer({ ...customer, comments })}
        />
        <ActivityLogSection customerId={id!} />
        <DocumentsSection customerId={id!} />
      </div>

      {compose && (
        <ComposeModal
          mode={compose}
          customer={customer}
          onClose={() => setCompose(null)}
        />
      )}

      <ConfirmModal
        isOpen={confirmOpen}
        message={`Delete ${fullName(customer)}? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

type ActionTileProps = {
  icon: string
  label: string
  href?: string
  to?: string
  onClick?: () => void
  active?: boolean
}

function ActionTile({ icon, label, href, to, onClick, active }: ActionTileProps) {
  const base =
    `flex flex-col items-center justify-center gap-1.5 w-16 shrink-0 py-3 rounded-2xl transition-colors cursor-pointer select-none ${
      active
        ? 'bg-indigo-600/40 text-indigo-300'
        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
    }`
  const inner = (
    <>
      <span className="text-xl leading-none">{icon}</span>
      <span className="text-[10px] font-medium leading-tight text-center">{label}</span>
    </>
  )
  if (href) return <a href={href} className={base}>{inner}</a>
  if (to)   return <Link to={to} className={base}>{inner}</Link>
  return <button onClick={onClick} className={base}>{inner}</button>
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      </div>
      <div className="divide-y divide-gray-700/30">{children}</div>
    </div>
  )
}

function maskSsn(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 9) return `•••-••-${digits.slice(5)}`
  if (digits.length >= 4)  return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`
  return '••••'
}

function SsnField({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false)
  if (!value) return null
  return (
    <div className="flex items-center px-4 py-3 gap-4">
      <span className="text-sm text-gray-500 w-28 shrink-0">Social Security</span>
      <span className="text-base text-gray-200 flex-1 font-mono tracking-wide">
        {revealed ? value : maskSsn(value)}
      </span>
      <button
        type="button"
        onClick={() => setRevealed(r => !r)}
        className="text-gray-500 hover:text-gray-300 transition-colors shrink-0"
        aria-label={revealed ? 'Hide SSN' : 'Reveal SSN'}
      >
        {revealed ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        )}
      </button>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex items-baseline px-4 py-3 gap-4">
      <span className="text-sm text-gray-500 w-28 shrink-0">{label}</span>
      <span className="text-base text-gray-200 flex-1 break-words">{value}</span>
    </div>
  )
}

function formatDate(d: Date): string {
  if (!d || isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function FollowUpSection({
  customerId,
  followUpDate,
  onUpdate,
}: {
  customerId: string
  followUpDate: Date | null
  onUpdate: (date: Date | null) => void
}) {
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  function toInputValue(d: Date | null): string {
    if (!d) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  async function handleChange(value: string) {
    const date = value ? new Date(value + 'T12:00:00') : null
    setSaving(true)
    try {
      await setFollowUpDate(customerId, date)
      onUpdate(date)
    } catch {
      toast('Could not save follow-up date', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      await setFollowUpDate(customerId, null)
      onUpdate(null)
    } catch {
      toast('Could not clear follow-up date', 'error')
    } finally {
      setSaving(false)
    }
  }

  const now = new Date(); now.setHours(0, 0, 0, 0)
  const isOverdue = followUpDate && followUpDate < now
  const isToday   = followUpDate && followUpDate.toDateString() === now.toDateString()

  const statusColor = isOverdue ? 'text-red-400' : isToday ? 'text-yellow-400' : 'text-green-400'
  const statusLabel = isOverdue ? 'Overdue' : isToday ? 'Today' : null

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Follow-up</p>
        {saving && (
          <span className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        <input
          type="date"
          value={toInputValue(followUpDate)}
          onChange={e => handleChange(e.target.value)}
          disabled={saving}
          className="input-field text-sm py-1.5 w-auto"
        />
        {followUpDate && (
          <>
            {statusLabel && (
              <span className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
            )}
            <button
              onClick={handleClear}
              disabled={saving}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          </>
        )}
        {!followUpDate && (
          <span className="text-sm text-gray-500">No follow-up scheduled</span>
        )}
      </div>
    </div>
  )
}

// ── Notes Timeline ────────────────────────────────────────────────────────────

interface NoteEntry {
  date: string   // e.g. "Aug 11, 2026"
  text: string
}

function parseNotes(raw: string): NoteEntry[] {
  if (!raw?.trim()) return []
  const parts = raw.split(/(?=--- \[)/)
  const entries: NoteEntry[] = []
  for (const part of parts) {
    const match = part.match(/^--- \[([^\]]+)\] ---\s*([\s\S]*)/)
    if (match) {
      const text = match[2].trim()
      if (text) entries.push({ date: match[1], text })
    } else {
      const text = part.trim()
      if (text) entries.push({ date: 'Original', text })
    }
  }
  return entries
}

function buildNoteHeader(): string {
  return `--- [${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}] ---`
}

function NotesSection({
  customer,
  onUpdate,
}: {
  customer: CustomerItem
  onUpdate: (comments: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft]   = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (adding) textareaRef.current?.focus()
  }, [adding])

  const entries = parseNotes(customer.comments ?? '')

  async function handleSave() {
    const text = draft.trim()
    if (!text) return
    setSaving(true)
    const newEntry = `${buildNoteHeader()}\n${text}`
    const existing = customer.comments?.trim() ?? ''
    const merged   = existing ? `${newEntry}\n\n${existing}` : newEntry
    try {
      await updateCustomer(customer.id, { ...customer, comments: merged })
      onUpdate(merged)
      setDraft('')
      setAdding(false)
    } catch {
      toast('Could not save note', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">
          Notes {entries.length > 0 && <span className="text-gray-600 font-normal normal-case">({entries.length})</span>}
        </p>
        <button
          onClick={() => { setAdding(a => !a); setDraft('') }}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {adding ? 'Cancel' : '+ Note'}
        </button>
      </div>

      {adding && (
        <div className="p-4 border-b border-gray-700/30 space-y-2.5">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave() }}
            rows={3}
            placeholder="Write a note…"
            className="input-field w-full resize-none text-sm"
          />
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving || !draft.trim()}
              className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? '…' : 'Save Note'}
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 && !adding ? (
        <p className="px-4 py-5 text-sm text-gray-500 text-center">No notes yet</p>
      ) : (
        <div className="relative">
          {entries.length > 1 && (
            <div className="absolute left-[27px] top-0 bottom-0 w-px bg-gray-800" aria-hidden="true" />
          )}
          <div className="divide-y divide-gray-700/20">
            {entries.map((entry, idx) => (
              <div key={idx} className="flex gap-3 px-4 py-3.5">
                <div className="w-5 h-5 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center shrink-0 mt-0.5 z-10">
                  <span className="text-[8px] text-gray-400">📝</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-500 mb-1">{entry.date}</p>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{entry.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityLogSection({ customerId }: { customerId: string }) {
  const user = useAuthStore(s => s.user)
  const [activities, setActivities] = useState<Activity[]>([])
  const [type, setType] = useState<ActivityType>('call')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const unsub = subscribeToActivities(customerId, setActivities, () => {})
    return unsub
  }, [customerId])

  async function handleAdd() {
    if (!note.trim() || !user) return
    setSaving(true)
    try {
      const userName = user.displayName || user.email || 'Unknown'
      await addActivity(customerId, type, note.trim(), user.uid, userName)
      setNote('')
    } finally {
      setSaving(false)
      textareaRef.current?.focus()
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try { await deleteActivity(id) } finally { setDeletingId(null) }
  }

  function formatTime(d: Date): string {
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1)  return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)  return `${hrs}h ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
  }

  const selected = ACTIVITY_TYPES.find(t => t.value === type)!

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Activity Log</p>
      </div>

      {/* Add activity form */}
      <div className="p-4 border-b border-gray-700/30 space-y-3">
        {/* Type selector */}
        <div className="flex gap-1.5 flex-wrap">
          {ACTIVITY_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                type === t.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Note input */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd() }}
            rows={2}
            placeholder={`Log a ${selected.label.toLowerCase()}…`}
            className="input-field flex-1 resize-none text-sm"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !note.trim()}
            className="btn-primary text-sm px-4 py-2 self-end disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {saving ? '…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Activity feed */}
      <div className="divide-y divide-gray-700/30">
        {activities.length === 0 ? (
          <p className="px-4 py-5 text-sm text-gray-500 text-center">No activity yet</p>
        ) : (
          activities.map(a => {
            const meta = ACTIVITY_TYPES.find(t => t.value === a.type) ?? ACTIVITY_TYPES[4]
            const isDeleting = deletingId === a.id
            const canDelete = user?.uid === a.userId
            return (
              <div key={a.id} className="flex gap-3 px-4 py-3 group">
                <span className="text-lg shrink-0 mt-0.5">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-300">{meta.label}</span>
                    <span className="text-xs text-gray-500">
                      {a.userName} · {formatTime(a.createdAt)}
                    </span>
                  </div>
                  {a.note && (
                    <p className="text-sm text-gray-200 mt-0.5 whitespace-pre-wrap">{a.note}</p>
                  )}
                </div>
                {canDelete && (
                  <button
                    onClick={() => handleDelete(a.id)}
                    disabled={isDeleting}
                    className="text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0 self-start mt-0.5"
                    aria-label="Delete activity"
                  >
                    {isDeleting ? (
                      <span className="w-3.5 h-3.5 border border-gray-500 border-t-transparent rounded-full animate-spin inline-block" />
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Lead Score ────────────────────────────────────────────────────────────────

function ScoreBadge({ customer }: { customer: CustomerItem }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const ls  = scoreLead(customer)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${ls.badgeClass}`}
        title="Lead score"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${ls.dotClass}`} />
        {ls.label} · {ls.score}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Lead Score</p>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ls.badgeClass}`}>
              {ls.score} / 100 — {ls.label}
            </span>
          </div>
          {/* Progress bar */}
          <div className="px-4 py-2.5 border-b border-gray-800">
            <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${ls.dotClass}`}
                style={{ width: `${ls.score}%` }}
              />
            </div>
          </div>
          {/* Factor breakdown */}
          <div className="py-2">
            {ls.factors.map(f => (
              <div key={f.label} className="flex items-center gap-2.5 px-4 py-1.5">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[9px] ${f.earned > 0 ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-600'}`}>
                  {f.earned > 0 ? '✓' : '○'}
                </span>
                <span className={`flex-1 text-xs ${f.earned > 0 ? 'text-gray-200' : 'text-gray-500'}`}>
                  {f.label}
                </span>
                <span className={`text-xs tabular-nums ${f.earned > 0 ? 'text-green-400 font-medium' : 'text-gray-600'}`}>
                  +{f.max}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tags ──────────────────────────────────────────────────────────────────────

function TagsSection({
  customerId,
  tags,
  allTags,
  onUpdate,
}: {
  customerId: string
  tags: string[]
  allTags: string[]
  onUpdate: (tags: string[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [input, setInput]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  async function addTag(raw: string) {
    const tag = raw.trim().toLowerCase()
    if (!tag || tags.includes(tag)) { setInput(''); setAdding(false); return }
    const next = [...tags, tag]
    onUpdate(next)
    await updateTags(customerId, next)
    setInput('')
    setAdding(false)
  }

  async function removeTag(tag: string) {
    const next = tags.filter(t => t !== tag)
    onUpdate(next)
    await updateTags(customerId, next)
  }

  const suggestions = allTags.filter(t => !tags.includes(t) && t.includes(input.toLowerCase()))
  const listId = `tag-suggestions-${customerId}`

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      {tags.map(tag => (
        <span
          key={tag}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${tagColor(tag)}`}
        >
          {tag}
          <button
            onClick={() => removeTag(tag)}
            className="opacity-60 hover:opacity-100 transition-opacity ml-0.5 leading-none"
            aria-label={`Remove tag ${tag}`}
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <div className="flex items-center gap-1">
          <datalist id={listId}>
            {suggestions.map(s => <option key={s} value={s} />)}
          </datalist>
          <input
            ref={inputRef}
            list={listId}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addTag(input) }
              if (e.key === 'Escape') { setAdding(false); setInput('') }
            }}
            onBlur={() => { if (!input.trim()) { setAdding(false) } }}
            placeholder="tag name…"
            className="bg-gray-800 border border-gray-600 rounded-full px-3 py-1 text-xs text-white placeholder-gray-500 outline-none focus:border-indigo-500 w-28"
          />
          <button
            onClick={() => addTag(input)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Add
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-gray-500 border border-gray-700 hover:border-gray-500 hover:text-gray-300 transition-colors"
        >
          + Tag
        </button>
      )}
    </div>
  )
}

// ── Compose modal ─────────────────────────────────────────────────────────────

type ComposeTemplate = { label: string; subject?: string; body: string }

function buildTemplates(
  mode: 'email' | 'sms',
  firstName: string,
  fullName: string,
  apptDate: string,
): ComposeTemplate[] {
  if (mode === 'email') {
    return [
      {
        label: 'Follow-Up',
        subject: `Following up — ${fullName}`,
        body: `Hi ${firstName},\n\nI wanted to follow up and see if you had any questions or if there's anything I can help you with.\n\nPlease feel free to reach out at any time.\n\nBest regards,`,
      },
      {
        label: 'Appointment',
        subject: `Your appointment${apptDate ? ` on ${apptDate}` : ''} — ${fullName}`,
        body: `Hi ${firstName},\n\nThis is a confirmation of your upcoming appointment${apptDate ? ` on ${apptDate}` : ''}.\n\nIf you need to reschedule or have any questions, don't hesitate to contact us.\n\nLooking forward to meeting with you!\n\nBest regards,`,
      },
      {
        label: 'Thank You',
        subject: `Thank you, ${firstName}!`,
        body: `Hi ${firstName},\n\nThank you so much for your business! We truly appreciate you choosing us.\n\nIf there's anything we can do to better serve you, please let us know.\n\nWarm regards,`,
      },
      {
        label: 'Custom',
        subject: `Hello ${firstName}`,
        body: '',
      },
    ]
  }
  return [
    {
      label: 'Follow-Up',
      body: `Hi ${firstName}, just wanted to follow up with you. Do you have any questions I can help with? Feel free to reply anytime.`,
    },
    {
      label: 'Appointment',
      body: `Hi ${firstName}, this is a reminder about your appointment${apptDate ? ` on ${apptDate}` : ''}. Please reply to confirm or call us to reschedule.`,
    },
    {
      label: 'Thank You',
      body: `Hi ${firstName}, thank you for your business! We appreciate you choosing us. Don't hesitate to reach out if you need anything.`,
    },
    {
      label: 'Custom',
      body: '',
    },
  ]
}

function ComposeModal({
  mode,
  customer,
  onClose,
}: {
  mode: 'email' | 'sms'
  customer: CustomerItem
  onClose: () => void
}) {
  const name      = fullName(customer)
  const firstName = customer.first.trim() || name
  const apptDate  = customer.startDate && !isNaN(customer.startDate.getTime()) && customer.startDate.getTime() > 86400000
    ? customer.startDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : ''

  const isEmail   = mode === 'email'
  const templates = buildTemplates(mode, firstName, name, apptDate)

  const [tmplIdx, setTmplIdx]   = useState(0)
  const [subject, setSubject]   = useState(templates[0].subject ?? '')
  const [body, setBody]         = useState(templates[0].body)
  const [copied, setCopied]     = useState(false)

  function selectTemplate(i: number) {
    setTmplIdx(i)
    setSubject(templates[i].subject ?? '')
    setBody(templates[i].body)
  }

  function buildHref() {
    if (isEmail) {
      const params = new URLSearchParams()
      if (subject) params.set('subject', subject)
      if (body)    params.set('body', body)
      return `mailto:${customer.email}?${params.toString()}`
    }
    return `sms:${customer.phone}${body ? `?&body=${encodeURIComponent(body)}` : ''}`
  }

  async function copyToClipboard() {
    const text = isEmail ? `Subject: ${subject}\n\n${body}` : body
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-700 shrink-0">
          <div>
            <p className="text-sm font-semibold text-white">
              {isEmail ? '✉️ Email' : '💬 Text'} {name}
            </p>
            <p className="text-xs text-gray-500">
              {isEmail ? customer.email : customer.phone}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Template tabs */}
        <div className="flex gap-1.5 px-4 py-2.5 border-b border-gray-700 shrink-0 overflow-x-auto scrollbar-none">
          {templates.map((t, i) => (
            <button
              key={t.label}
              onClick={() => selectTemplate(i)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                tmplIdx === i
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Compose area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isEmail && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500"
                placeholder="Subject…"
              />
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={isEmail ? 9 : 5}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500 resize-none"
              placeholder="Write your message…"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-gray-700 flex gap-2 shrink-0">
          <a
            href={buildHref()}
            className="flex-1 btn-primary text-sm py-2.5 text-center"
          >
            Open in {isEmail ? 'Email App' : 'Messages'}
          </a>
          {!isEmail && customer.phone && (
            <a
              href={`https://wa.me/${customer.phone.replace(/\D/g, '')}${body ? `?text=${encodeURIComponent(body)}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm px-4 py-2.5 text-green-400"
            >
              WhatsApp
            </a>
          )}
          <button
            onClick={copyToClipboard}
            className={`btn-secondary text-sm px-4 py-2.5 transition-colors ${copied ? 'text-green-400' : ''}`}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Documents ─────────────────────────────────────────────────────────────────

function DocumentsSection({ customerId }: { customerId: string }) {
  const user = useAuthStore(s => s.user)
  const fileRef = useRef<HTMLInputElement>(null)
  const [docs, setDocs]         = useState<CustomerDocument[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress]   = useState(0)
  const [error, setError]         = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    const unsub = subscribeToDocuments(customerId, setDocs, () => {})
    return unsub
  }, [customerId])

  async function handleFiles(files: FileList | null) {
    if (!files?.length || !user) return
    setError(null)
    setUploading(true)
    setProgress(0)
    try {
      const displayName = user.displayName ?? user.email ?? 'Unknown'
      for (const file of Array.from(files)) {
        await uploadDocument(customerId, file, user.uid, displayName, pct => setProgress(pct))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDelete(doc: CustomerDocument) {
    setConfirmId(null)
    try { await deleteDocument(doc) } catch { /* ignore */ }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Documents {docs.length > 0 && <span className="text-gray-600 font-normal normal-case">({docs.length})</span>}
        </p>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40"
        >
          + Attach
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />

      {/* Drop zone — shown only when list is empty */}
      {docs.length === 0 && !uploading && (
        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-gray-500 cursor-pointer hover:bg-gray-700/20 transition-colors"
        >
          <span className="text-3xl">📎</span>
          <p className="text-sm">Drop files here or click Attach</p>
          <p className="text-xs text-gray-600">Max 10 MB per file</p>
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div className="px-4 py-3 space-y-1.5">
          <p className="text-xs text-gray-400">Uploading… {progress}%</p>
          <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="px-4 py-2 text-xs text-red-400">{error}</p>
      )}

      {/* Document list */}
      {docs.length > 0 && (
        <div className="divide-y divide-gray-700/40">
          {docs.map(d => (
            <div
              key={d.id}
              className="flex items-center gap-3 px-4 py-3 group hover:bg-gray-700/20 transition-colors"
            >
              <span className="text-xl shrink-0">{fileIcon(d.mimeType)}</span>
              <div className="flex-1 min-w-0">
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-100 hover:text-indigo-300 truncate block transition-colors"
                >
                  {d.name}
                </a>
                <p className="text-xs text-gray-500">
                  {formatFileSize(d.size)} · {d.uploadedByName} · {d.createdAt.toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={d.url}
                  download={d.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-all"
                  title="Download"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                </a>
                {confirmId === d.id ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleDelete(d)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                    <button onClick={() => setConfirmId(null)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmId(d.id)}
                    className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone overlay when list has items */}
      {docs.length > 0 && (
        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          className="px-4 py-2.5 border-t border-gray-700/40 text-center text-xs text-gray-600 hover:text-gray-400 cursor-pointer hover:bg-gray-700/10 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          Drop more files here or click to attach
        </div>
      )}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 animate-pulse space-y-4">
      <div className="h-4 bg-gray-700 rounded w-16" />
      <div className="card p-6">
        <div className="flex gap-5">
          <div className="w-16 h-16 rounded-full bg-gray-700" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="h-6 bg-gray-700 rounded w-48" />
            <div className="h-4 bg-gray-700/60 rounded w-24" />
          </div>
        </div>
      </div>
      <div className="card p-4 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 bg-gray-700 rounded" style={{ width: `${60 + i * 8}%` }} />
        ))}
      </div>
    </div>
  )
}
