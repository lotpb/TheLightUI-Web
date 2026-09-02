import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getCustomer, deleteCustomer, deactivateCustomer, updateCustomer, setFollowUpDate, setContactAttempts } from '../../services/customerService'
import { fullName, formatCurrency, CATEGORY_LABELS, type CustomerItem, type CustomerCategory } from '../../models/customer'
import { printCustomer, downloadICS, downloadVCF } from '../../utils/exportUtils'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import { useNavBack } from '../../hooks/useNavBack'
import { usePickerStore } from '../../stores/pickerStore'
import { useAuthStore } from '../../stores/authStore'
import { subscribeToActivities, addActivity, deleteActivity } from '../../services/activityService'
import { ACTIVITY_TYPES, type Activity, type ActivityType } from '../../models/activity'
import { subscribeToDocuments, uploadDocument, deleteDocument } from '../../services/documentService'
import { formatFileSize, fileIcon, type CustomerDocument } from '../../models/document'
import { updateTags } from '../../services/customerService'
import { tagColor } from '../../utils/tagColor'
import { scoreLead } from '../../utils/leadScore'
import { subscribeToCustomFieldDefs } from '../../services/customFieldService'
import type { CustomFieldDef } from '../../models/customField'
import { subscribeToEmailThread, markEmailRead, sendEmail } from '../../services/emailMessageService'
import type { EmailMessage } from '../../models/emailMessage'
import { subscribeToSmsThread, sendSms } from '../../services/smsMessageService'
import type { SmsMessage } from '../../models/smsMessage'
import { subscribeToCompanyProfile } from '../../services/companyProfileService'
import DraftReplyButton from '../../components/DraftReplyButton'
import { subscribeToRecipientsByCustomer } from '../../services/campaignService'
import { RECIPIENT_STATUS_COLORS, type CampaignRecipient } from '../../models/campaign'
import { subscribeToEntityAuditLog } from '../../services/auditLogService'
import { fieldLabel, type AuditLogEntry } from '../../models/auditLog'
import { calculateHealthScore, type CustomerHealth } from '../../utils/customerHealth'
import { subscribeToTemplates } from '../../services/templateService'
import { interpolate, type MessageTemplate } from '../../models/template'
import {
  subscribeToSequences, subscribeToCustomerEnrollments,
  enrollCustomer, pauseEnrollment, resumeEnrollment, cancelEnrollment, deleteEnrollment,
} from '../../services/sequenceService'
import type { Sequence, SequenceEnrollment } from '../../models/sequence'
import { subscribeToCustomerInvoices } from '../../services/invoiceService'
import { subscribeToCustomerProposals } from '../../services/proposalService'
import { subscribeToCustomerServicePlans } from '../../services/servicePlanService'
import { generatePortalLink } from '../../services/customerPortalService'
import { subscribeToCustomerWarranties } from '../../services/warrantyService'
import { isExpired as warrantyIsExpired, isExpiringSoon as warrantyIsExpiringSoon, type Warranty } from '../../models/warranty'
import { effectiveStatus, statusClasses, statusLabel, invoiceTotal, fmtCurrency } from '../../models/invoice'
import type { Invoice } from '../../models/invoice'
import {
  effectiveStatus as proposalEffectiveStatus, statusClasses as proposalStatusClasses,
  statusLabel as proposalStatusLabel, proposalTotal,
} from '../../models/proposal'
import type { Proposal } from '../../models/proposal'
import { FREQUENCY_LABELS, type ServicePlan } from '../../models/servicePlan'
import { subscribeToCustomerServiceRequests } from '../../services/serviceRequestService'
import { STATUS_LABELS as REQUEST_STATUS_LABELS, STATUS_COLORS as REQUEST_STATUS_COLORS, type ServiceRequest } from '../../models/serviceRequest'
import { subscribeToCustomerTimeEntries, type TimeEntry } from '../../services/timeTrackingService'
import { subscribeToCustomerSigningRequests } from '../../services/signingRequestService'
import { STATUS_LABELS as SIGNING_STATUS_LABELS, STATUS_COLORS as SIGNING_STATUS_COLORS, type SigningRequest } from '../../models/signingRequest'
import { subscribeToJobPurchaseOrders } from '../../services/purchaseOrderService'
import { STATUS_LABELS as PO_STATUS_LABELS, STATUS_COLORS as PO_STATUS_COLORS, poTotal, type PurchaseOrder } from '../../models/purchaseOrder'
import { subscribeToCustomerReferrals, type Referral } from '../../services/referralService'
import { findMemberByEmail } from '../../services/teamService'
import { subscribeToCustomerTodos, addTodo, toggleTodo, deleteTodo } from '../../services/todoService'
import type { Todo } from '../../models/todo'

const ROLE_COLORS: Record<string, string> = {
  owner:    'bg-yellow-500/20 text-yellow-300 border-yellow-600/30',
  admin:    'bg-indigo-500/20 text-indigo-300 border-indigo-600/30',
  salesman: 'bg-teal-500/20 text-teal-300 border-teal-600/30',
  viewer:   'bg-gray-500/20 text-gray-400 border-gray-600/30',
}

// These panels are driven by customerId-scoped queries. A silently-swallowed
// error would render as an empty section that looks like "no records" — most
// plausibly a missing Firestore index after a query shape changes — so surface
// it instead of hiding it.
function logRelatedError(label: string): (err: Error) => void {
  return err => console.error(`[CustomerDetailPage] ${label} subscription failed:`, err)
}

type TabKey = 'details' | 'related' | 'activity' | 'tasks' | 'texts' | 'email' | 'sequences' | 'documents'

const TAB_DEFS: { key: TabKey; label: string; icon?: string }[] = [
  { key: 'details',   label: 'Details' },
  { key: 'activity',  label: 'Activity' },
  { key: 'tasks',     label: 'Tasks' },
  { key: 'related',   label: 'Related' },
  { key: 'texts',     label: 'Texts' },
  { key: 'email',     label: 'Email' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'documents', label: 'Files', icon: '📎' },
]

function DetailTabBar({
  active,
  counts,
  onChange,
}: {
  active: TabKey
  counts: Record<TabKey, number>
  onChange: (key: TabKey) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Partial<Record<TabKey, HTMLButtonElement>>>({})
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  useEffect(() => {
    function measure() {
      const btn = btnRefs.current[active]
      const container = containerRef.current
      if (!btn || !container) return
      const containerRect = container.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      setIndicator({ left: btnRect.left - containerRect.left + container.scrollLeft, width: btnRect.width })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])

  return (
    <div className="border-b border-gray-800 mb-6">
      <div ref={containerRef} className="relative flex gap-6 overflow-x-auto scrollbar-none">
        {TAB_DEFS.map(tab => {
          const isActive = active === tab.key
          const count = counts[tab.key]
          return (
            <button
              key={tab.key}
              ref={el => { if (el) btnRefs.current[tab.key] = el }}
              onClick={() => onChange(tab.key)}
              className={`flex items-center gap-1.5 pb-3 pt-1 text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
                isActive ? 'text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.icon && <span className="text-base leading-none">{tab.icon}</span>}
              <span>{tab.label}</span>
              {count > 0 && (
                <span className={`text-xs font-semibold rounded-full px-1.5 py-0.5 leading-none transition-colors ${
                  isActive ? 'bg-indigo-500/20 text-indigo-300' : 'bg-gray-800 text-gray-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
        {indicator && (
          <span
            className="absolute bottom-0 h-[2px] bg-indigo-500 rounded-full transition-all duration-200 ease-out"
            style={{ left: indicator.left, width: indicator.width }}
          />
        )}
      </div>
    </div>
  )
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navBack  = useNavBack('/records')
  const toast = useToast()
  const [customer, setCustomer] = useState<CustomerItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [compose, setCompose] = useState<'email' | 'sms' | null>(null)
  // All four are already scoped to this customer — no further filtering needed.
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [plans, setPlans] = useState<ServicePlan[]>([])
  const [warranties, setWarranties] = useState<Warranty[]>([])
  const [generatingPortal, setGeneratingPortal] = useState(false)
  // No isReady guard is needed on the subscriptions below: ProtectedRoute
  // already blocks this route until companyId resolves.
  const companyId = useAuthStore(s => s.companyId)
  const [linkedRole, setLinkedRole] = useState<string>('')
  const [linkedLastSeen, setLinkedLastSeen] = useState<Date | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('details')
  const [tabCounts, setTabCounts] = useState<Record<TabKey, number>>({
    details: 0, related: 0, activity: 0, tasks: 0, texts: 0, email: 0, sequences: 0, documents: 0,
  })

  useEffect(() => {
    if (!id) return
    getCustomer(id)
      .then(c => { setCustomer(c); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    const isEmployee = customer?.category?.toLowerCase() === 'employee'
    if (!isEmployee || !customer?.email || !companyId) { setLinkedRole(''); setLinkedLastSeen(null); return }
    findMemberByEmail(customer.email)
      .then(member => {
        setLinkedRole(member?.role ?? '')
        setLinkedLastSeen(member?.lastSeen ?? null)
      })
      .catch(() => { setLinkedRole(''); setLinkedLastSeen(null) })
  }, [customer?.email, customer?.category, companyId])

  // Scoped to this customer rather than pulling the whole company collection
  // and filtering client-side: the company-wide subscriptions are capped, so a
  // customer's older invoices/plans/warranties could fall outside the cap and
  // silently vanish from this page.
  useEffect(() => {
    if (!id) return
    return subscribeToCustomerInvoices(id, setInvoices, logRelatedError('invoices'))
  }, [id, companyId])

  useEffect(() => {
    if (!id) return
    return subscribeToCustomerProposals(id, setProposals, logRelatedError('proposals'))
  }, [id, companyId])

  useEffect(() => {
    if (!id) return
    return subscribeToCustomerServicePlans(id, setPlans, logRelatedError('service plans'))
  }, [id, companyId])

  useEffect(() => {
    if (!id) return
    return subscribeToCustomerWarranties(id, setWarranties, logRelatedError('warranties'))
  }, [id, companyId])

  async function handlePortalLink() {
    if (!customer) return
    setGeneratingPortal(true)
    try {
      const url = await generatePortalLink(customer, invoices, plans)
      await navigator.clipboard.writeText(url)
      toast('Portal link copied to clipboard!', 'success')
    } catch {
      toast('Failed to generate portal link', 'error')
    } finally {
      setGeneratingPortal(false)
    }
  }

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
    const isEmployee = customer.category?.toLowerCase() === 'employee'
    if (customer.isActive) {
      const employeeStatus = isEmployee ? 'Inactive' : customer.employeeStatus
      await deactivateCustomer(id, isEmployee ? { employeeStatus } : {})
      setCustomer({ ...customer, isActive: false, employeeStatus })
    } else {
      const employeeStatus = isEmployee ? 'Active' : customer.employeeStatus
      await updateCustomer(id, { ...customer, isActive: true, employeeStatus })
      setCustomer({ ...customer, isActive: true, employeeStatus })
    }
  }

  const labels = usePickerStore(s => s.labels)

  if (loading) return <LoadingSkeleton />

  if (!customer) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-400">Record not found.</p>
        <button onClick={navBack} className="mt-4 text-indigo-400 hover:text-indigo-300">← Go back</button>
      </div>
    )
  }

  const catLabel = customer.category
    ? (CATEGORY_LABELS[customer.category as CustomerCategory] ?? customer.category)
    : ''

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Back + actions */}
      <div className="flex items-start justify-between mb-6 gap-2 flex-wrap">
        <button onClick={navBack} className="text-indigo-400 hover:text-indigo-300 text-sm mt-1">
          ← Back
        </button>
        <div className="flex gap-2 flex-wrap justify-end">
          <Link to={`/records/${id}/edit`} className="btn-secondary text-sm px-3 py-1.5">Edit</Link>
          <button onClick={() => setConfirmOpen(true)} disabled={deleting} className="btn-danger text-sm px-3 py-1.5">
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
        {/* ── Sidebar: identity, status, actions, tags ─────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="card px-4 py-2 text-center">
            <h1 className="text-xl font-bold text-white leading-tight break-words">
              {customer.category.toLowerCase() === 'vendor'
                ? customer.first || '—'
                : [customer.first, customer.lastname].filter(Boolean).join(' ') || '—'}
            </h1>
          </div>

          <div className="card p-6 relative overflow-hidden">
            <div className="pointer-events-none absolute -top-20 -right-20 w-48 h-48 bg-indigo-600/10 rounded-full blur-3xl" />

            <div className="relative flex flex-col items-center text-center gap-3">
              {customer.amount > 0 && (
                <p className="text-2xl font-bold text-green-400 -mt-1 self-start text-left w-full">{formatCurrency(customer.amount)}</p>
              )}

              {customer.category.toLowerCase() === 'vendor' && (
                <p className="text-lg font-semibold text-gray-300 self-start text-left w-full">{customer.profession || '—'}</p>
              )}

              {customer.category.toLowerCase() === 'employee' && (
                <p className="text-3xl font-semibold text-gray-300 self-start text-left w-full">{customer.adNo || '—'}</p>
              )}

              <div className="flex flex-nowrap gap-1.5 justify-center overflow-x-auto max-w-full">
                {catLabel && (
                  <span className="inline-flex items-center shrink-0 text-xs font-medium bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full">
                    {catLabel}
                  </span>
                )}
                <span className={`inline-flex items-center shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${
                  customer.isActive ? 'bg-green-500/15 text-green-400' : 'bg-gray-700/50 text-gray-400'
                }`}>
                  {customer.isActive ? 'Active' : 'Inactive'}
                </span>
                {customer.rate && (
                  <span className="inline-flex items-center shrink-0 text-xs font-medium bg-yellow-500/15 text-yellow-300 px-2.5 py-1 rounded-full">
                    ★ {customer.rate}
                  </span>
                )}
                {(customer.category.toLowerCase() === 'vendor' ? customer.salesman : customer.callback).toLowerCase() === 'yes' && (
                  <span className="inline-flex items-center shrink-0 gap-1 text-xs font-medium bg-green-500/15 text-green-400 px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3 fill-current shrink-0" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    Called
                  </span>
                )}
              </div>
            </div>

            {/* Action tiles */}
            <div className="grid grid-cols-4 gap-2 mt-5 pt-4 border-t border-gray-700/50">
              {customer.phone && (
                <ActionTile
                  href={`tel:${customer.phone}`}
                  icon={(
                    <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                    </svg>
                  )}
                  label="Call"
                />
              )}
              {customer.phone && (
                <ActionTile onClick={() => setCompose('sms')} icon="💬" label="Message" />
              )}
              {customer.email && (
                <ActionTile onClick={() => setCompose('email')} icon="✉️" label="Email" />
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
                label="Active"
                active={customer.isActive}
              />
              <ActionTile to={`/proposals/new?customerId=${id}`} icon="📝" label="Proposal" />
              <ActionTile to={`/invoices/new?customerId=${id}`} icon="🧾" label="Invoice" />
              <ActionTile to={`/records/${id}/quote`} icon="📋" label="Quote" />
              <ActionTile onClick={() => downloadVCF(customer)} icon="👤" label="Contact" />
              {customer.startDate && !isNaN(customer.startDate.getTime()) && customer.startDate.getTime() > 0 && (
                <ActionTile onClick={() => downloadICS(customer)} icon="📅" label="Calendar" />
              )}
              <ActionTile
                onClick={handlePortalLink}
                icon={generatingPortal ? '…' : '🔗'}
                label="Portal"
              />
              <ActionTile
                onClick={() => printCustomer(customer, msg => toast(msg, 'error'))}
                icon="🖨️"
                label="Print"
              />
            </div>
          </div>

          {/* Tags + Score */}
          <div className="card p-4">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Tags</p>
              {(customer.category.toLowerCase() === 'lead' || customer.category.toLowerCase() === 'customer') && (
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Overall Score</p>
              )}
            </div>
            <div className="flex items-start justify-between gap-2">
              <TagsSection
                customerId={id!}
                tags={customer.tags ?? []}
                allTags={[]}
                onUpdate={tags => setCustomer({ ...customer, tags })}
              />
              {customer.category.toLowerCase() === 'lead' && (
                <ScoreBadge customer={customer} />
              )}
              {customer.category.toLowerCase() === 'customer' && (
                <HealthScoreBadge customer={customer} invoices={invoices} plans={plans} />
              )}
            </div>
          </div>

          <FollowUpSection
            customerId={id!}
            followUpDate={customer.followUpDate}
            onUpdate={date => setCustomer({ ...customer, followUpDate: date })}
          />

          <CalledSection
            customer={customer}
            onUpdateAttempts={attempts => setCustomer({ ...customer, contactAttempts: attempts })}
          />
        </aside>

        {/* ── Main: tabbed content ──────────────────────────────────────── */}
        <main className="min-w-0">
          <DetailTabBar active={activeTab} counts={tabCounts} onChange={setActiveTab} />

      <div className={activeTab === 'details' ? 'space-y-4' : 'hidden'}>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldGroup title="Contact">
            <Field label="Phone"    value={customer.phone} />
            <Field label="Email"    value={customer.email || '—'} />
            {customer.category.toLowerCase() === 'vendor' && (
              <Field label="Web Page" value={customer.spouse} />
            )}
          </FieldGroup>

          <FieldGroup title="Dates">
            {customer.category.toLowerCase() === 'lead' && (
              <DateField label="Apt Date" value={formatDate(customer.startDate)} />
            )}
            {customer.category.toLowerCase() === 'employee' && (
              <FieldRow>
                <FieldCell label="Start Date"><DateChip>{formatDate(customer.startDate) || '—'}</DateChip></FieldCell>
                <FieldCell label="Termination"><DateChip>{formatDate(customer.completionDate) || '—'}</DateChip></FieldCell>
              </FieldRow>
            )}
            {customer.category.toLowerCase() === 'customer' && (
              <FieldRow>
                <FieldCell label="Start"><DateChip>{formatDate(customer.startDate) || '—'}</DateChip></FieldCell>
                <FieldCell label="Complete"><DateChip>{formatDate(customer.completionDate) || '—'}</DateChip></FieldCell>
              </FieldRow>
            )}
            <FieldRow>
              <FieldCell label="Date Added"><DateChip>{formatDate(customer.creationDate) || '—'}</DateChip></FieldCell>
              <FieldCell label="Last Update"><DateChip>{formatDate(customer.lastUpdateDate) || '—'}</DateChip></FieldCell>
            </FieldRow>
          </FieldGroup>
        </div>

        <FieldGroup title="Address">
          <Field label="Street" value={customer.street} />
          <Field
            label="City"
            value={
              [customer.city, [customer.state, customer.zip].filter(Boolean).join(' ')]
                .filter(Boolean).join(', ')
            }
          />
        </FieldGroup>

        <FieldGroup title={
          customer.category.toLowerCase() === 'employee' ? 'Employee Info' :
          customer.category.toLowerCase() === 'vendor' ? 'Vendor Info' : 'Job Info'
        }>
          {customer.category.toLowerCase() !== 'vendor' && (
            customer.category.toLowerCase() === 'employee' ? (
              <FieldRow>
                <FieldCell label="Salesperson">{customer.salesman || '—'}</FieldCell>
                <FieldCell label="Emp. Status">
                  {customer.employeeStatus
                    ? <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                        customer.employeeStatus === 'Active'   ? 'bg-green-500/20 text-green-300 border-green-600/30' :
                        customer.employeeStatus === 'Inactive' ? 'bg-red-500/20 text-red-300 border-red-600/30' :
                        customer.employeeStatus === 'On Leave' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-600/30' :
                        'bg-gray-700 text-gray-400 border-gray-600/30'
                      }`}>{customer.employeeStatus}</span>
                    : <span className="text-gray-400 text-sm">—</span>}
                </FieldCell>
              </FieldRow>
            ) : (
              null
            )
          )}
          {customer.category.toLowerCase() !== 'employee' && (
            <>
              {customer.category.toLowerCase() === 'vendor' && (
                <>
                  <FieldRow>
                    <FieldCell label="Profession">{customer.profession || '—'}</FieldCell>
                    <FieldCell label="Manager">{customer.callback || '—'}</FieldCell>
                  </FieldRow>
                  <Field label="Payment Terms" value={customer.paymentTerms} />
                  <Field label="Tax ID"         value={customer.taxId} />
                  <Field label="Account Number" value={customer.accountNumber} />
                </>
              )}
            </>
          )}
          {customer.category.toLowerCase() !== 'vendor' && customer.category.toLowerCase() !== 'employee' ? (
            (customer.salesman || customer.job) && (
              <FieldRow>
                <FieldCell label={labels.salesman}>{customer.salesman || '—'}</FieldCell>
                <FieldCell label={labels.job}>{customer.job || '—'}</FieldCell>
              </FieldRow>
            )
          ) : (
            <Field label={labels.job} value={customer.job} />
          )}
          {customer.category.toLowerCase() === 'customer' && (
            <Field label={labels.contractor} value={customer.contractor || '—'} />
          )}
          {customer.category.toLowerCase() !== 'vendor' && customer.category.toLowerCase() !== 'employee' ? (
            (customer.product || customer.quantity > 0) && (
              <FieldRow>
                <FieldCell label={labels.product}>{customer.product || '—'}</FieldCell>
                <FieldCell label="Quantity">{customer.quantity > 0 ? String(customer.quantity) : '—'}</FieldCell>
              </FieldRow>
            )
          ) : (
            <>
              <Field label={labels.product} value={customer.product} />
              <Field label="Quantity" value={customer.quantity > 0 ? String(customer.quantity) : ''} />
            </>
          )}
          {customer.category.toLowerCase() === 'employee' && (
            <>
              <FieldRow>
                <FieldCell label="Department">{customer.adNo || '—'}</FieldCell>
                <FieldCell label="Rating">{customer.rate || '—'}</FieldCell>
              </FieldRow>
              <FieldRow>
                <FieldCell label="Pay Type">{customer.payType || '—'}</FieldCell>
                <FieldCell label="Commission">{customer.commissionRate || '—'}</FieldCell>
              </FieldRow>
              <FieldRow>
                <FieldCell label="User Role">
                  {(linkedRole || customer.userRole)
                    ? (() => { const r = linkedRole || customer.userRole; return (
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${ROLE_COLORS[r.toLowerCase()] ?? 'bg-gray-700 text-gray-400 border-gray-600/30'}`}>
                          {r.charAt(0).toUpperCase() + r.slice(1)}
                        </span>
                      )})()
                    : <span className="text-gray-400 text-sm">—</span>}
                </FieldCell>
                <FieldCell label="Last Login">
                  <DateChip>
                    {linkedLastSeen
                      ? linkedLastSeen.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
                      : customer.lastLogin || <span className="text-gray-400">—</span>}
                  </DateChip>
                </FieldCell>
              </FieldRow>
            </>
          )}
        </FieldGroup>

        {customer.category.toLowerCase() === 'customer' && (
          <FieldGroup title="Customer Info">
            <Field label="Company Name"   value={customer.companyName} />
            <FieldRow>
              <FieldCell label="Lead Source">{customer.leadSource || '—'}</FieldCell>
              <FieldCell label="Spouse">{customer.spouse || '—'}</FieldCell>
            </FieldRow>
            {(customer.paymentStatus || customer.paymentTerms) && (
              <FieldRow>
                <FieldCell label="Payment Status">{customer.paymentStatus || '—'}</FieldCell>
                <FieldCell label="Payment Terms">{customer.paymentTerms || '—'}</FieldCell>
              </FieldRow>
            )}
          </FieldGroup>
        )}

        {customer.category.toLowerCase() === 'lead' && (
          <>
            <FieldGroup title="Lead Info">
              <FieldRow>
                <FieldCell label="Lead Source">{customer.leadSource || '—'}</FieldCell>
                <FieldCell label="Lead Status">{customer.leadStatus || '—'}</FieldCell>
              </FieldRow>
              <FieldRow>
                <FieldCell label="Last Contact"><DateChip>{formatISODateShort(customer.lastContactDate) || '—'}</DateChip></FieldCell>
                <FieldCell label="Spouse">{customer.spouse || '—'}</FieldCell>
              </FieldRow>
            </FieldGroup>
          </>
        )}
        {customer.category.toLowerCase() === 'employee' && (
          <FieldGroup title="Personal">
            <FieldRow>
              <FieldCell label="Social Security"><SsnValue value={customer.spouse} /></FieldCell>
              <FieldCell label="Driver License">{customer.driverLicense || '—'}</FieldCell>
            </FieldRow>
            <DateField label="Birth Date" value={customer.birthDate} />
          </FieldGroup>
        )}

        <CustomFieldsSection customer={customer} />
      </div>

      <div className={activeTab === 'related' ? 'space-y-4' : 'hidden'}>
        <RelatedRecordsSection
          customerId={id!}
          invoices={invoices}
          proposals={proposals}
          warranties={warranties}
          servicePlans={plans}
          onCount={n => setTabCounts(c => (c.related === n ? c : { ...c, related: n }))}
        />
      </div>

      <div className={activeTab === 'activity' ? 'space-y-4' : 'hidden'}>
        <ActivityLogSection
          customerId={id!}
          onCount={n => setTabCounts(c => (c.activity === n ? c : { ...c, activity: n }))}
        />
        <AuditHistorySection entityId={id!} />
      </div>

      <div className={activeTab === 'tasks' ? 'space-y-4' : 'hidden'}>
        <TasksSection
          customer={customer}
          onCount={n => setTabCounts(c => (c.tasks === n ? c : { ...c, tasks: n }))}
        />
      </div>

      <div className={activeTab === 'texts' ? 'space-y-4' : 'hidden'}>
        <SmsThreadSection
          customerId={id!}
          phone={customer.phone}
          onCount={n => setTabCounts(c => (c.texts === n ? c : { ...c, texts: n }))}
        />
      </div>

      <div className={activeTab === 'email' ? 'space-y-4' : 'hidden'}>
        <EmailThreadSection
          customerId={id!}
          email={customer.email}
          onCount={n => setTabCounts(c => (c.email === n ? c : { ...c, email: n }))}
        />
        <CampaignHistorySection customerId={id!} />
      </div>

      <div className={activeTab === 'sequences' ? 'space-y-4' : 'hidden'}>
        <SequencesSection
          customer={customer}
          onCount={n => setTabCounts(c => (c.sequences === n ? c : { ...c, sequences: n }))}
        />
      </div>

      <div className={activeTab === 'documents' ? 'space-y-4' : 'hidden'}>
        <DocumentsSection
          customerId={id!}
          onCount={n => setTabCounts(c => (c.documents === n ? c : { ...c, documents: n }))}
        />
      </div>
        </main>
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
  icon: ReactNode
  label: string
  href?: string
  to?: string
  onClick?: () => void
  active?: boolean
}

function ActionTile({ icon, label, href, to, onClick, active }: ActionTileProps) {
  const base =
    `flex flex-col items-center justify-center gap-1.5 w-full py-3 rounded-2xl transition-colors cursor-pointer select-none ${
      active
        ? 'bg-gray-700 text-white hover:bg-gray-600'
        : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700'
    }`
  const inner = (
    <>
      <span className="text-lg leading-none flex items-center justify-center">{icon}</span>
      <span className="text-[11px] font-medium leading-tight text-center">{label}</span>
    </>
  )
  if (href) return <a href={href} className={base}>{inner}</a>
  if (to)   return <Link to={to} className={base}>{inner}</Link>
  return <button onClick={onClick} className={base}>{inner}</button>
}

function CustomFieldsSection({ customer }: { customer: CustomerItem }) {
  const [defs, setDefs] = useState<CustomFieldDef[]>([])
  useEffect(() => subscribeToCustomFieldDefs(setDefs, () => {}), [])

  if (defs.length === 0) return null

  const pairs: CustomFieldDef[][] = []
  for (let i = 0; i < defs.length; i += 2) pairs.push(defs.slice(i, i + 2))

  return (
    <FieldGroup title="Custom Fields">
      {pairs.map((pair, i) => (
        <FieldRow key={i}>
          {pair.map(def => (
            <FieldCell key={def.id} label={def.label}>
              {customer.customFields?.[def.key] || '—'}
            </FieldCell>
          ))}
        </FieldRow>
      ))}
    </FieldGroup>
  )
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

// Label sits above its value; used both standalone and inside multi-column FieldRow grids.
function FieldCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-gray-400 mb-1">{label}</p>
      <div className="text-base text-gray-200 break-words">{children}</div>
    </div>
  )
}

function FieldRow({ children }: { children: React.ReactNode }) {
  const cols = Array.isArray(children) ? children.length : 1
  return (
    <div className={`grid gap-4 px-4 py-3 ${cols >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {children}
    </div>
  )
}

function maskSsn(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 9) return `•••-••-${digits.slice(5)}`
  if (digits.length >= 4)  return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`
  return '••••'
}

function SsnValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false)
  if (!value) return <span className="text-gray-400">—</span>
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono tracking-wide">{revealed ? value : maskSsn(value)}</span>
      <button
        type="button"
        onClick={() => setRevealed(r => !r)}
        className="text-gray-400 hover:text-gray-300 transition-colors shrink-0"
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
    <div className="px-4 py-3">
      <FieldCell label={label}>{value}</FieldCell>
    </div>
  )
}

// Matches the Follow-up section's date chip so every date value shares the same background.
function DateChip({ children }: { children: React.ReactNode }) {
  return (
    <div className="input-field inline-block w-auto text-sm py-1.5" style={{ cursor: 'default' }}>
      {children}
    </div>
  )
}

function DateField({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="px-4 py-3">
      <FieldCell label={label}><DateChip>{value}</DateChip></FieldCell>
    </div>
  )
}

function formatDate(d: Date | null): string {
  if (!d || isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatISODateShort(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  const day = String(d.getDate()).padStart(2, '0')
  return `${month} ${day} ${d.getFullYear()}`
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
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <div className="input-field text-sm py-1.5" style={{ minWidth: '130px', cursor: 'pointer', userSelect: 'none' }}>
            {followUpDate
              ? (() => { const d = followUpDate; const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${mo[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}` })()
              : <span className="text-gray-400">Select date</span>}
          </div>
          <input
            type="date"
            value={toInputValue(followUpDate)}
            onChange={e => handleChange(e.target.value)}
            disabled={saving}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
          />
        </div>
        {followUpDate && (
          <>
            {statusLabel && (
              <span className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
            )}
            <button
              onClick={handleClear}
              disabled={saving}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          </>
        )}
        {!followUpDate && (
          <span className="text-sm text-gray-400">No follow-up scheduled</span>
        )}
      </div>
    </div>
  )
}

function CalledSection({
  customer,
  onUpdateAttempts,
}: {
  customer: CustomerItem
  onUpdateAttempts: (attempts: number) => void
}) {
  const called = (customer.category.toLowerCase() === 'vendor' ? customer.salesman : customer.callback).toLowerCase() === 'yes'
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  async function handleChange(next: number) {
    const attempts = Math.max(0, next)
    if (attempts === customer.contactAttempts) return
    setSaving(true)
    try {
      await setContactAttempts(customer.id, attempts)
      onUpdateAttempts(attempts)
    } catch {
      toast('Could not save attempts', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Called</p>
        <span className="text-base font-medium text-gray-400 ml-auto">Attempts</span>
      </div>
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <svg className={`w-4 h-4 fill-current shrink-0 ${called ? 'text-green-400' : 'text-gray-400'}`} viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
          <span className={called ? 'text-white' : 'text-gray-400'}>{called ? 'Yes' : 'No'}</span>
        </span>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleChange(customer.contactAttempts - 1)}
              disabled={saving || customer.contactAttempts <= 0}
              className="w-5 h-5 flex items-center justify-center rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 transition-colors text-xs leading-none"
            >
              −
            </button>
            <span className="text-gray-300 font-medium w-4 text-center">{customer.contactAttempts}</span>
            <button
              type="button"
              onClick={() => handleChange(customer.contactAttempts + 1)}
              disabled={saving}
              className="w-5 h-5 flex items-center justify-center rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 transition-colors text-xs leading-none"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AuditHistorySection({ entityId, onCount }: { entityId: string; onCount?: (n: number) => void }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => subscribeToEntityAuditLog(entityId, setEntries, () => {}), [entityId])

  useEffect(() => { onCount?.(entries.length) }, [entries.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = expanded ? entries : entries.slice(0, 3)

  function fmtTime(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">History</p>
      </div>
      {entries.length === 0 && (
        <p className="px-4 py-5 text-sm text-gray-400 text-center">No history yet</p>
      )}
      <div className="divide-y divide-gray-700/30">
        {visible.map(entry => (
          <div key={entry.id} className="px-4 py-2.5">
            <p className="text-xs text-gray-400">
              <span className="text-gray-300 font-medium capitalize">{entry.action}</span>
              {' by '}{entry.changedBy} · {fmtTime(entry.createdAt)}
            </p>
            {entry.changes.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {entry.changes.map((c, i) => (
                  <li key={i} className="text-xs text-gray-400">
                    <span className="text-gray-400">{fieldLabel(c.field)}</span>
                    {': '}{c.from || '(empty)'} → <span className="text-gray-300">{c.to || '(empty)'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {entries.length > 3 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full px-4 py-2 text-xs text-indigo-400 hover:text-indigo-300 border-t border-gray-700/30 transition-colors"
        >
          {expanded ? 'Show less' : `Show ${entries.length - 3} more`}
        </button>
      )}
    </div>
  )
}

const TASK_PRIORITY_STYLES: Record<Todo['priority'], string> = {
  low:    'bg-gray-500/20 text-gray-400 border-gray-600/40',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-600/40',
  high:   'bg-red-500/20 text-red-400 border-red-600/40',
}

function TasksSection({ customer, onCount }: { customer: CustomerItem; onCount?: (n: number) => void }) {
  const user = useAuthStore(s => s.user)
  const toast = useToast()
  const [tasks, setTasks] = useState<Todo[]>([])
  const [notes, setNotes] = useState('')
  const [adding, setAdding] = useState(false)
  const title = fullName(customer)

  useEffect(() => subscribeToCustomerTodos(customer.id, setTasks, () => {}), [customer.id])

  useEffect(() => { onCount?.(tasks.filter(t => !t.isCompleted).length) }, [tasks]) // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit = notes.trim().length > 0

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !user) return
    setAdding(true)
    try {
      await addTodo(user.uid, title, 'medium', notes.trim(), null, customer.id, title)
      setNotes('')
    } catch {
      toast('Could not add task', 'error')
    } finally {
      setAdding(false)
    }
  }

  async function handleToggle(t: Todo) {
    try {
      await toggleTodo(t.id, !t.isCompleted)
    } catch {
      toast('Could not update task', 'error')
    }
  }

  async function handleDelete(t: Todo) {
    try {
      await deleteTodo(t.id)
    } catch {
      toast('Could not delete task', 'error')
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Tasks</p>
        <Link to="/todo" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</Link>
      </div>

      <form onSubmit={handleAdd} className="px-4 py-3 border-b border-gray-700/30 space-y-2">
        <input
          type="text"
          value={title}
          readOnly
          disabled
          className="input-field text-sm w-full opacity-70 cursor-not-allowed"
        />
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes (optional)…"
          disabled={adding}
          className="input-field text-sm w-full"
        />
        <div className="flex justify-end">
          <button type="submit" disabled={adding || !canSubmit} className="btn-primary text-sm px-4">
            {adding ? '…' : 'Add'}
          </button>
        </div>
      </form>

      {tasks.length === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-400 text-center">No tasks linked to this record yet</p>
      ) : (
        <div className="divide-y divide-gray-700/30">
          {tasks.map(t => (
            <div key={t.id} className="px-4 py-3 flex items-center gap-3">
              <span
                role="checkbox"
                aria-checked={t.isCompleted}
                onClick={() => handleToggle(t)}
                className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-all"
                style={t.isCompleted
                  ? { backgroundImage: 'linear-gradient(135deg, #34d399, #059669)', borderColor: '#059669' }
                  : { borderColor: '#6366f1' }}
              >
                {t.isCompleted && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${t.isCompleted ? 'line-through text-gray-400' : 'text-gray-100'}`}>{t.title}</p>
                {t.notes && (
                  <p className="text-sm text-gray-400 mt-0.5">{t.notes}</p>
                )}
                {t.dueDate && (
                  <p className="text-xs text-indigo-400 mt-0.5">
                    Due {t.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${TASK_PRIORITY_STYLES[t.priority]}`}>
                {t.priority}
              </span>
              <button
                onClick={() => handleDelete(t)}
                className="text-gray-400 hover:text-red-400 transition-colors shrink-0"
                aria-label="Delete task"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Home-services text conversations are the primary channel, so this finally
// wires up sendSms/subscribeToSmsThread — both were fully implemented in
// smsMessageService but had no UI calling them.
function SmsThreadSection({
  customerId, phone, onCount,
}: { customerId: string; phone: string; onCount?: (n: number) => void }) {
  const toast = useToast()
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [smsNumber, setSmsNumber] = useState('')
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => subscribeToSmsThread(customerId, setMessages, () => {}), [customerId])
  useEffect(() => subscribeToCompanyProfile(
    p => { setSmsNumber(p.smsNumber ?? ''); setProfileLoaded(true) },
    () => setProfileLoaded(true),
  ), [])

  useEffect(() => { onCount?.(messages.length) }, [messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  function fmtTime(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  async function handleSend() {
    const text = body.trim()
    if (!text) return
    setSending(true)
    try {
      await sendSms(customerId, text)
      setBody('')
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Could not send that text'
      toast(message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Texts</p>
      </div>

      {messages.length === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-400 text-center">No text messages yet</p>
      ) : (
        <div className="divide-y divide-gray-700/30">
          {messages.map(m => (
            <div key={m.id} className="px-4 py-3">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                  m.direction === 'outbound' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-green-500/20 text-green-300'
                }`}>
                  {m.direction === 'outbound' ? 'Sent' : 'Received'}
                </span>
                <span className="text-xs text-gray-400">{fmtTime(m.createdAt)}</span>
                {m.status === 'failed' && (
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">Failed</span>
                )}
              </div>
              <p className="text-sm text-gray-300 mt-0.5 whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-3 border-t border-gray-700/50 space-y-2">
        {!profileLoaded ? null : !smsNumber ? (
          <p className="text-xs text-gray-500">
            Texting isn't set up for this account yet — add a number in{' '}
            <Link to="/sms-inbox" className="text-indigo-400 hover:underline">SMS settings</Link> to send from here.
          </p>
        ) : !phone ? (
          <p className="text-xs text-gray-500">This customer has no phone number on file.</p>
        ) : (
          <>
            <DraftReplyButton
              customerId={customerId}
              channel="sms"
              currentValue={body}
              onDraft={r => setBody(r.body)}
              disabled={sending}
            />
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Type a text…"
              rows={2}
              className="input-field w-full text-sm resize-none"
              disabled={sending}
            />
            <div className="flex justify-end">
              <button
                onClick={handleSend}
                disabled={sending || !body.trim()}
                className="btn-primary text-sm px-4 py-1.5"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function EmailThreadSection({
  customerId, email, onCount,
}: { customerId: string; email: string; onCount?: (n: number) => void }) {
  const toast = useToast()
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => subscribeToEmailThread(customerId, setMessages, () => {}), [customerId])

  useEffect(() => { onCount?.(messages.length) }, [messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  function fmtTime(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    try {
      await sendEmail(customerId, subject.trim(), body.trim())
      setSubject('')
      setBody('')
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Could not send that email'
      toast(message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Email Thread</p>
      </div>
      {messages.length === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-400 text-center">No email messages yet</p>
      ) : (
      <div className="divide-y divide-gray-700/30">
        {messages.map(m => (
          <div
            key={m.id}
            className="px-4 py-3"
            onClick={() => { if (m.direction === 'inbound' && !m.read) markEmailRead(m.id) }}
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                m.direction === 'outbound' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-green-500/20 text-green-300'
              }`}>
                {m.direction === 'outbound' ? 'Sent' : 'Received'}
              </span>
              {m.direction === 'inbound' && !m.read && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" title="Unread" />
              )}
              <span className="text-xs text-gray-400">{fmtTime(m.createdAt)}</span>
            </div>
            {m.subject && <p className="text-sm font-medium text-gray-200 mt-1">{m.subject}</p>}
            <p className="text-sm text-gray-400 mt-0.5 whitespace-pre-wrap line-clamp-3">{m.body}</p>
          </div>
        ))}
      </div>
      )}

      <div className="px-4 py-3 border-t border-gray-700/50 space-y-2">
        {!email ? (
          <p className="text-xs text-gray-500">This customer has no email address on file.</p>
        ) : (
          <>
            <DraftReplyButton
              customerId={customerId}
              channel="email"
              currentValue={body}
              onDraft={r => { setBody(r.body); if (r.subject) setSubject(r.subject) }}
              disabled={sending}
            />
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject"
              className="input-field w-full text-sm"
              disabled={sending}
            />
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Write a reply…"
              rows={4}
              className="input-field w-full text-sm resize-none"
              disabled={sending}
            />
            <div className="flex justify-end">
              <button
                onClick={handleSend}
                disabled={sending || !subject.trim() || !body.trim()}
                className="btn-primary text-sm px-4 py-1.5"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CampaignHistorySection({ customerId }: { customerId: string }) {
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([])

  useEffect(() => subscribeToRecipientsByCustomer(customerId, setRecipients, () => {}), [customerId])

  if (recipients.length === 0) return null

  const sorted = [...recipients].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())

  function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Campaigns</p>
      </div>
      <div className="divide-y divide-gray-700/30">
        {sorted.map(r => (
          <Link
            key={r.id}
            to={`/campaigns/${r.campaignId}`}
            className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-800/40 transition-colors"
          >
            <span className="text-sm text-gray-200">{fmtDate(r.sentAt)}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${RECIPIENT_STATUS_COLORS[r.status]}`}>
              {r.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ── Related Records (Customer 360) ─────────────────────────────────────────────
// Pulls records from other modules that reference this customer's id, so the
// full relationship — billing, service history, time on site — is visible in
// one place instead of requiring a separate search in each module.

function RelatedRecordsSection({
  customerId,
  invoices,
  proposals,
  warranties,
  servicePlans,
  onCount,
}: {
  customerId: string
  invoices: Invoice[]
  proposals: Proposal[]
  warranties: Warranty[]
  servicePlans: ServicePlan[]
  onCount?: (n: number) => void
}) {
  // Each of these is scoped to this customer server-side. They used to pull
  // whole company collections and filter here, which meant a busy company's
  // records could fall outside the subscription cap and silently disappear
  // from this panel — and cost nine full-collection reads per page view.
  const [myRequests, setMyRequests] = useState<ServiceRequest[]>([])
  const [myTimeEntries, setMyTimeEntries] = useState<TimeEntry[]>([])
  const [mySigningRequests, setMySigningRequests] = useState<SigningRequest[]>([])
  const [myPurchaseOrders, setMyPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [referredByMe, setReferredByMe] = useState<Referral[]>([])
  const [referredToMe, setReferredToMe] = useState<Referral[]>([])

  useEffect(() => subscribeToCustomerServiceRequests(customerId, setMyRequests, logRelatedError('service requests')), [customerId])
  useEffect(() => subscribeToCustomerTimeEntries(customerId, setMyTimeEntries, logRelatedError('time entries')), [customerId])
  useEffect(() => subscribeToCustomerSigningRequests(customerId, setMySigningRequests, logRelatedError('signing requests')), [customerId])
  useEffect(() => subscribeToJobPurchaseOrders(customerId, setMyPurchaseOrders, logRelatedError('purchase orders')), [customerId])
  useEffect(() => subscribeToCustomerReferrals(
    customerId,
    (byThem, toThem) => { setReferredByMe(byThem); setReferredToMe(toThem) },
    logRelatedError('referrals'),
  ), [customerId])

  const totalCount = invoices.length + proposals.length + warranties.length + servicePlans.length + myRequests.length + myTimeEntries.length +
    mySigningRequests.length + myPurchaseOrders.length + referredByMe.length + referredToMe.length
  useEffect(() => { onCount?.(totalCount) }, [totalCount]) // eslint-disable-line react-hooks/exhaustive-deps

  function warrantyStatus(w: Warranty): { label: string; cls: string } {
    if (!w.isActive) return { label: 'Inactive', cls: 'bg-gray-700/60 text-gray-400 border-gray-600/40' }
    if (warrantyIsExpired(w))      return { label: 'Expired',       cls: 'bg-red-500/20    text-red-400    border-red-600/40' }
    if (warrantyIsExpiringSoon(w)) return { label: 'Expiring Soon', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-600/40' }
    return { label: 'Active', cls: 'bg-green-500/20 text-green-400 border-green-600/40' }
  }

  function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function fmtDuration(mins: number | null): string {
    if (mins == null) return 'In progress'
    const h = Math.floor(mins / 60), m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Related Records</p>
      </div>

      {totalCount === 0 && (
        <p className="px-4 py-5 text-sm text-gray-400 text-center">No related records yet</p>
      )}

      {invoices.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700/30">
          <p className="text-xs font-semibold text-gray-400 mb-2">Invoices ({invoices.length})</p>
          <div className="space-y-1.5">
            {invoices.slice(0, 5).map(inv => {
              const status = effectiveStatus(inv)
              return (
                <Link
                  key={inv.id}
                  to={`/invoices/${inv.id}`}
                  className="flex items-center justify-between gap-2 py-1 hover:bg-gray-800/50 rounded-lg px-1.5 -mx-1.5 transition-colors"
                >
                  <span className="text-sm text-gray-300 truncate">{inv.invoiceNumber || 'Draft'}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {inv.recurring && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-indigo-500/20 text-indigo-400 border-indigo-600/40">
                        Recurring
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusClasses(status)}`}>
                      {statusLabel(status)}
                    </span>
                    <span className="text-sm text-gray-400">{fmtCurrency(invoiceTotal(inv))}</span>
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {proposals.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700/30">
          <p className="text-xs font-semibold text-gray-400 mb-2">Proposals ({proposals.length})</p>
          <div className="space-y-1.5">
            {proposals.slice(0, 5).map(p => {
              const status = proposalEffectiveStatus(p)
              return (
                <Link
                  key={p.id}
                  to={`/proposals/${p.id}`}
                  className="flex items-center justify-between gap-2 py-1 hover:bg-gray-800/50 rounded-lg px-1.5 -mx-1.5 transition-colors"
                >
                  <span className="text-sm text-gray-300 truncate">{p.proposalNumber || 'Draft'}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${proposalStatusClasses(status)}`}>
                      {proposalStatusLabel(status)}
                    </span>
                    <span className="text-sm text-gray-400">{fmtCurrency(proposalTotal(p))}</span>
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {warranties.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700/30">
          <p className="text-xs font-semibold text-gray-400 mb-2">Warranties ({warranties.length})</p>
          <div className="space-y-1.5">
            {warranties.slice(0, 5).map(w => {
              const status = warrantyStatus(w)
              return (
                <div key={w.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="text-sm text-gray-300 truncate">{w.title || 'Untitled'}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${status.cls}`}>
                      {status.label}
                    </span>
                    <span className="text-xs text-gray-400">{fmtDate(w.expirationDate)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {servicePlans.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700/30">
          <p className="text-xs font-semibold text-gray-400 mb-2">Service Plans ({servicePlans.length})</p>
          <div className="space-y-1.5">
            {servicePlans.slice(0, 5).map(sp => (
              <div key={sp.id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-sm text-gray-300 truncate">{sp.title || 'Untitled'}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${sp.isActive ? 'bg-green-500/20 text-green-400 border-green-600/40' : 'bg-gray-700/60 text-gray-400 border-gray-600/40'}`}>
                    {sp.isActive ? FREQUENCY_LABELS[sp.frequency] : 'Inactive'}
                  </span>
                  <span className="text-xs text-gray-400">Next: {fmtDate(sp.nextDate)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {myRequests.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700/30">
          <p className="text-xs font-semibold text-gray-400 mb-2">Service Requests ({myRequests.length})</p>
          <div className="space-y-1.5">
            {myRequests.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-sm text-gray-300 truncate">{r.description || 'No description'}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REQUEST_STATUS_COLORS[r.status]}`}>
                    {REQUEST_STATUS_LABELS[r.status]}
                  </span>
                  <span className="text-xs text-gray-400">{fmtDate(r.createdAt)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {myTimeEntries.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700/30">
          <p className="text-xs font-semibold text-gray-400 mb-2">Time on Site ({myTimeEntries.length})</p>
          <div className="space-y-1.5">
            {myTimeEntries.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-sm text-gray-300 truncate">{t.clockedInBy || 'Unknown'}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-gray-400">{fmtDuration(t.durationMinutes)}</span>
                  <span className="text-xs text-gray-400">{fmtDate(t.clockIn)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {mySigningRequests.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700/30">
          <p className="text-xs font-semibold text-gray-400 mb-2">Signing Requests ({mySigningRequests.length})</p>
          <div className="space-y-1.5">
            {mySigningRequests.slice(0, 5).map(sr => (
              <div key={sr.id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-sm text-gray-300 truncate">{sr.document.templateName || 'Untitled document'}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SIGNING_STATUS_COLORS[sr.status]}`}>
                    {SIGNING_STATUS_LABELS[sr.status]}
                  </span>
                  <span className="text-xs text-gray-400">{fmtDate(sr.createdAt)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {myPurchaseOrders.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700/30">
          <p className="text-xs font-semibold text-gray-400 mb-2">Purchase Orders ({myPurchaseOrders.length})</p>
          <div className="space-y-1.5">
            {myPurchaseOrders.slice(0, 5).map(po => (
              <Link
                key={po.id}
                to="/purchase-orders"
                className="flex items-center justify-between gap-2 py-1 hover:bg-gray-800/50 rounded-lg px-1.5 -mx-1.5 transition-colors"
              >
                <span className="text-sm text-gray-300 truncate">{po.poNumber || 'Draft'}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PO_STATUS_COLORS[po.status]}`}>
                    {PO_STATUS_LABELS[po.status]}
                  </span>
                  <span className="text-sm text-gray-400">{fmtCurrency(poTotal(po))}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {(referredByMe.length > 0 || referredToMe.length > 0) && (
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-gray-400 mb-2">Referrals ({referredByMe.length + referredToMe.length})</p>
          <div className="space-y-1.5">
            {referredByMe.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-sm text-gray-300 truncate">Referred: {r.referredName || 'Unknown'}</span>
                {r.referredAmount > 0 && <span className="text-sm text-gray-400 shrink-0">{fmtCurrency(r.referredAmount)}</span>}
              </div>
            ))}
            {referredToMe.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-sm text-gray-300 truncate">Referred by: {r.referrerName || 'Unknown'}</span>
                {r.referredAmount > 0 && <span className="text-sm text-gray-400 shrink-0">{fmtCurrency(r.referredAmount)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityLogSection({ customerId, onCount }: { customerId: string; onCount?: (n: number) => void }) {
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

  useEffect(() => { onCount?.(activities.length) }, [activities.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <p className="px-4 py-5 text-sm text-gray-400 text-center">No activity yet</p>
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
                    <span className="text-xs text-gray-400">
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
    <div ref={ref} className="relative shrink-0 flex items-center gap-2">
      <button
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${ls.badgeClass}`}
        title="Lead score"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${ls.dotClass}`} />
        {ls.label}
      </button>
      <span className="text-2xl font-bold text-white">{ls.score}</span>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Lead Score</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ls.badgeClass}`}>
                {ls.label}
              </span>
            </div>
            <p className="text-3xl font-bold text-white mt-1">
              {ls.score}<span className="text-sm font-normal text-gray-400"> / 100</span>
            </p>
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
                <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-xs ${f.earned > 0 ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-600'}`}>
                  {f.earned > 0 ? '✓' : '○'}
                </span>
                <span className={`flex-1 text-xs ${f.earned > 0 ? 'text-gray-200' : 'text-gray-400'}`}>
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

// ── Customer Health Score ─────────────────────────────────────────────────────

function HealthScoreBadge({
  customer,
  invoices,
  plans,
}: {
  customer: CustomerItem
  invoices: Invoice[]
  plans: ServicePlan[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const hs: CustomerHealth = calculateHealthScore(customer, invoices, plans)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0 flex items-center gap-2">
      <button
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${hs.badgeClass}`}
        title="Customer health score"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${hs.dotClass}`} />
        {hs.label}
      </button>
      <span className="text-2xl font-bold text-white">{hs.score}</span>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Health Score</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${hs.badgeClass}`}>
                {hs.label}
              </span>
            </div>
            <p className="text-3xl font-bold text-white mt-1">
              {hs.score}<span className="text-sm font-normal text-gray-400"> / 100</span>
            </p>
          </div>
          <div className="px-4 py-2.5 border-b border-gray-800">
            <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${hs.barClass}`}
                style={{ width: `${hs.score}%` }}
              />
            </div>
          </div>
          <div className="py-2">
            {hs.factors.map(f => (
              <div key={f.label} className="flex items-start gap-2.5 px-4 py-1.5">
                <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-xs ${f.earned > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-600'}`}>
                  {f.earned > 0 ? '✓' : '○'}
                </span>
                <div className="flex-1 min-w-0">
                  <span className={`text-xs ${f.earned > 0 ? 'text-gray-200' : 'text-gray-400'}`}>{f.label}</span>
                  {f.detail && (
                    <p className="text-xs text-gray-600 truncate">{f.detail}</p>
                  )}
                </div>
                <span className={`text-xs tabular-nums shrink-0 ${f.earned > 0 ? 'text-emerald-400 font-medium' : 'text-gray-600'}`}>
                  {f.earned}/{f.max}
                </span>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-gray-800">
            <p className="text-xs text-gray-600">Updates live as you add notes, invoices, and service plans</p>
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
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-gray-300 transition-colors"
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
  const builtIn   = buildTemplates(mode, firstName, name, apptDate)

  // Load saved templates from Firestore
  const [savedTemplates, setSavedTemplates] = useState<MessageTemplate[]>([])
  useEffect(() => {
    return subscribeToTemplates(
      ts => setSavedTemplates(ts.filter(t => t.type === mode || t.type === 'both')),
      () => {},
    )
  }, [mode])

  const vars = {
    firstName, name, date: apptDate,
    amount: customer.amount > 0 ? formatCurrency(customer.amount) : '',
    phone:  customer.phone,
    email:  customer.email,
  }

  // Tabs: saved templates first (marked with a ★), then built-in
  const allTabs: Array<{ label: string; subject: string; body: string; saved?: boolean }> = [
    ...savedTemplates.map(t => ({
      label:   t.name,
      subject: interpolate(t.subject, vars),
      body:    interpolate(t.body, vars),
      saved:   true,
    })),
    ...builtIn.map(t => ({ label: t.label, subject: t.subject ?? '', body: t.body })),
  ]

  const [tmplIdx, setTmplIdx]   = useState(0)
  const [subject, setSubject]   = useState(allTabs[0]?.subject ?? '')
  const [body, setBody]         = useState(allTabs[0]?.body ?? '')
  const [copied, setCopied]     = useState(false)

  // When saved templates load, re-initialize body from the selected tab
  useEffect(() => {
    const tab = allTabs[tmplIdx]
    if (tab) { setSubject(tab.subject); setBody(tab.body) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTemplates.length])

  const templates = allTabs

  function selectTemplate(i: number) {
    setTmplIdx(i)
    setSubject(allTabs[i].subject ?? '')
    setBody(allTabs[i].body)
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
            <p className="text-xs text-gray-400">
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
              key={`${t.label}-${i}`}
              onClick={() => selectTemplate(i)}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                tmplIdx === i
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.saved && <span className="text-yellow-400 text-xs">★</span>}
              {t.label}
            </button>
          ))}
        </div>

        {/* Compose area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isEmail && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Subject</label>
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
            <label className="text-xs text-gray-400 mb-1 block">Message</label>
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

function DocumentsSection({ customerId, onCount }: { customerId: string; onCount?: (n: number) => void }) {
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

  useEffect(() => { onCount?.(docs.length) }, [docs.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
          Files {docs.length > 0 && <span className="text-gray-600 font-normal normal-case">({docs.length})</span>}
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
          className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-gray-400 cursor-pointer hover:bg-gray-700/20 transition-colors"
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
                <p className="text-xs text-gray-400">
                  {formatFileSize(d.size)} · {d.uploadedByName} · {d.createdAt.toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={d.url}
                  download={d.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-all"
                  title="Download"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                </a>
                {confirmId === d.id ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleDelete(d)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                    <button onClick={() => setConfirmId(null)} className="text-xs text-gray-400 hover:text-gray-300">Cancel</button>
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

// ── Sequences ─────────────────────────────────────────────────────────────────

function SequencesSection({ customer, onCount }: { customer: CustomerItem; onCount?: (n: number) => void }) {
  const toast = useToast()
  const [sequences,    setSequences]    = useState<Sequence[]>([])
  const [enrollments,  setEnrollments]  = useState<SequenceEnrollment[]>([])
  const [enrollOpen,   setEnrollOpen]   = useState(false)
  const [enrolling,    setEnrolling]    = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const enrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeToSequences(setSequences, () => {}), [])
  useEffect(() => subscribeToCustomerEnrollments(customer.id, setEnrollments, () => {}), [customer.id])

  useEffect(() => { onCount?.(enrollments.length) }, [enrollments.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enrollOpen) return
    function handle(e: MouseEvent) {
      if (enrollRef.current && !enrollRef.current.contains(e.target as Node)) setEnrollOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [enrollOpen])

  async function handleEnroll(seq: Sequence) {
    setEnrolling(seq.id)
    setEnrollOpen(false)
    try {
      await enrollCustomer(seq, customer.id, fullName(customer))
      toast(`Enrolled in "${seq.name}"`, 'success')
    } catch {
      toast('Failed to enroll', 'error')
    } finally {
      setEnrolling(null)
    }
  }

  async function handlePause(id: string) {
    try { await pauseEnrollment(id); toast('Paused', 'success') }
    catch { toast('Failed to pause', 'error') }
  }

  async function handleResume(enr: SequenceEnrollment) {
    const seq = sequences.find(s => s.id === enr.sequenceId)
    if (!seq) return
    try {
      await resumeEnrollment(enr.id, seq.steps, enr.nextStepIdx, enr.startedAt)
      toast('Resumed', 'success')
    } catch { toast('Failed to resume', 'error') }
  }

  async function handleCancel(id: string) {
    try { await cancelEnrollment(id); toast('Cancelled', 'success') }
    catch { toast('Failed to cancel', 'error') }
  }

  async function handleDeleteEnrollment(id: string) {
    setConfirmDeleteId(null)
    try { await deleteEnrollment(id); toast('Enrollment deleted', 'success') }
    catch { toast('Failed to delete', 'error') }
  }

  const activeEnrollments = enrollments.filter(e => e.status === 'active' || e.status === 'paused')
  const pastEnrollments   = enrollments.filter(e => e.status === 'completed' || e.status === 'cancelled')

  const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
    active:    { label: 'Active',    cls: 'bg-green-500/15 text-green-300' },
    paused:    { label: 'Paused',    cls: 'bg-amber-500/15 text-amber-300' },
    completed: { label: 'Completed', cls: 'bg-indigo-500/15 text-indigo-300' },
    cancelled: { label: 'Cancelled', cls: 'bg-gray-700/50 text-gray-400' },
  }

  function daysAgo(d: Date) {
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
    return days === 0 ? 'today' : `${days}d ago`
  }

  function daysUntil(d: Date) {
    const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000)
    if (days <= 0) return 'today'
    return `in ${days}d`
  }

  return (
    <div className="card">
      <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 rounded-t-xl flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">
          Sequences {activeEnrollments.length > 0 && (
            <span className="text-gray-600 font-normal normal-case">({activeEnrollments.length} active)</span>
          )}
        </p>
        {sequences.length > 0 && (
          <div ref={enrollRef} className="relative">
            <button
              onClick={() => setEnrollOpen(v => !v)}
              disabled={!!enrolling}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40"
            >
              {enrolling ? '…' : '+ Enroll'}
            </button>
            {enrollOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 max-h-72 overflow-y-auto bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50">
                <p className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700 sticky top-0 bg-gray-800 rounded-t-xl">Choose a sequence</p>
                {sequences.map(seq => (
                  <button
                    key={seq.id}
                    onClick={() => handleEnroll(seq)}
                    className="w-full text-left px-3 py-2.5 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    <p className="font-medium leading-snug">{seq.name}</p>
                    <p className="text-xs text-gray-400">{seq.steps.length} step{seq.steps.length !== 1 ? 's' : ''}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {activeEnrollments.length === 0 && pastEnrollments.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="text-sm text-gray-400">No active sequences</p>
          {sequences.length === 0 && (
            <p className="text-xs text-gray-600 mt-1">
              Create sequences at <a href="/sequences" className="text-indigo-400 hover:text-indigo-300">Outreach → Sequences</a>
            </p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-700/30">
          {activeEnrollments.map(enr => {
            const st = STATUS_STYLE[enr.status]
            const seq = sequences.find(s => s.id === enr.sequenceId)
            return (
              <div key={enr.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-sm font-medium text-gray-200">{enr.sequenceName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Started {daysAgo(enr.startedAt)}
                    {enr.status === 'active' && seq && enr.nextStepIdx < seq.steps.length && (
                      <> · step {enr.nextStepIdx + 1}/{seq.steps.length} runs {daysUntil(enr.nextRunAt)}</>
                    )}
                    {enr.completedStepIndices.length > 0 && (
                      <> · {enr.completedStepIndices.length} step{enr.completedStepIndices.length !== 1 ? 's' : ''} done</>
                    )}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {enr.status === 'active' && (
                    <button
                      onClick={() => handlePause(enr.id)}
                      className="text-xs text-gray-400 hover:text-amber-400 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    >
                      Pause
                    </button>
                  )}
                  {enr.status === 'paused' && (
                    <button
                      onClick={() => handleResume(enr)}
                      className="text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    >
                      Resume
                    </button>
                  )}
                  <button
                    onClick={() => handleCancel(enr.id)}
                    className="text-xs text-gray-600 hover:text-red-400 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(enr.id)}
                    className="text-xs text-gray-600 hover:text-red-400 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    title="Delete this enrollment"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
          {pastEnrollments.slice(0, 3).map(enr => {
            const st = STATUS_STYLE[enr.status]
            return (
              <div key={enr.id} className="px-4 py-2.5 flex items-center justify-between gap-3 opacity-60">
                <span className="text-sm text-gray-400">{enr.sequenceName}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                  <button
                    onClick={() => setConfirmDeleteId(enr.id)}
                    className="text-xs text-gray-600 hover:text-red-400 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    title="Delete this enrollment"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmDeleteId}
        message="Delete this enrollment? This removes it from the customer's history and cannot be undone."
        onConfirm={() => confirmDeleteId && handleDeleteEnrollment(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
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
