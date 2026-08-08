import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getCustomer, deleteCustomer, deactivateCustomer, updateCustomer } from '../../services/customerService'
import { fullName, formatCurrency, CATEGORY_LABELS, type CustomerItem, type CustomerCategory } from '../../models/customer'
import { printCustomer, downloadICS, downloadVCF } from '../../utils/exportUtils'

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<CustomerItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    getCustomer(id)
      .then(c => { setCustomer(c); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  async function handleDelete() {
    if (!id || !customer) return
    if (!window.confirm(`Delete ${fullName(customer)}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await deleteCustomer(id)
      navigate(-1)
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

  if (loading) return <LoadingSkeleton />

  if (!customer) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-400">Record not found.</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-indigo-400 hover:text-indigo-300">← Go back</button>
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
        <button onClick={() => navigate(-1)} className="text-indigo-400 hover:text-indigo-300 text-sm">
          ← Back
        </button>
        <div className="flex gap-2">
          <Link to={`/records/${id}/edit`} className="btn-secondary text-sm px-3 py-1.5">Edit</Link>
          <button onClick={handleDelete} disabled={deleting} className="btn-danger text-sm px-3 py-1.5">
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
                  <div style={{ width: '56px', height: '56px', borderRadius: '9999px', background: 'rgba(67,56,202,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '18px', fontWeight: 700, color: 'rgb(165,180,252)' }}>
                      {[customer.first[0], customer.lastname[0]].filter(Boolean).join('').toUpperCase() || '?'}
                    </span>
                  </div>
                )}
              </td>
              <td style={{ verticalAlign: 'top', paddingLeft: '16px', overflow: 'hidden' }}>
                {/* Desktop: first + last on one line */}
                <h1 className="hidden sm:block" style={{ fontSize: '22px', fontWeight: 700, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                  {[customer.first, customer.lastname].filter(Boolean).join(' ') || '—'}
                </h1>
                {/* Mobile: two lines */}
                <div className="sm:hidden">
                  <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{customer.first || '—'}</h1>
                  {customer.lastname && (
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
              href={`sms:${customer.phone}`}
              icon="💬"
              label="Message"
            />
          )}
          {customer.email && (
            <ActionTile
              href={`mailto:${customer.email}`}
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
            onClick={() => printCustomer(customer)}
            icon="🖨️"
            label="Print"
          />
        </div>
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
            <Field label="Salesman" value={customer.salesman} />
          )}
          {customer.category.toLowerCase() !== 'employee' && (
            <>
              {customer.category.toLowerCase() === 'vendor' && (
                <>
                  <div className="flex items-center px-4 py-3 gap-4">
                    <span className="text-sm text-gray-500 w-28 shrink-0">Profession</span>
                    <span className="text-base text-gray-200 flex-1 break-words">{customer.lastname || '—'}</span>
                    <span className="text-sm text-gray-500 shrink-0 ml-4">Called</span>
                    <span className="text-base flex items-center gap-1.5">
                      <svg className={`w-4 h-4 fill-current shrink-0 ${customer.salesman.toLowerCase() === 'yes' ? 'text-green-400' : 'text-gray-500'}`} viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                      <span className={customer.salesman.toLowerCase() === 'yes' ? 'text-white' : 'text-gray-500'}>
                        {customer.salesman.toLowerCase() === 'yes' ? 'Yes' : 'No'}
                      </span>
                    </span>
                  </div>
                  <Field label="Manager"    value={customer.callback || '—'} />
                </>
              )}
              {customer.category.toLowerCase() === 'customer' && (
                <Field label="Contractor" value={customer.contractor || '—'} />
              )}
            </>
          )}
          <Field label="Job"        value={customer.job} />
          <Field label="Product"    value={customer.product} />
          <Field label="Quantity"   value={customer.quantity > 0 ? String(customer.quantity) : ''} />
          <Field
            label={customer.category.toLowerCase() === 'employee' ? 'Department' : 'Advertiser'}
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
            <Field label="Social Security" value={customer.spouse} />
            <Field label="Driver License"  value={customer.driverLicense} />
          </FieldGroup>
        )}

        <FieldGroup title="Dates">
          {customer.category.toLowerCase() === 'lead' && (
            <Field label="Apt Date" value={formatDate(customer.startDate)} />
          )}
          {customer.category.toLowerCase() === 'employee' && (
            <div className="flex items-center px-4 py-3 gap-4">
              <span className="text-sm text-gray-500 w-28 shrink-0">Start Date</span>
              <span className="text-base text-gray-200 flex-1 break-words">{formatDate(customer.startDate) || '—'}</span>
              <span className="text-sm text-gray-500 shrink-0 ml-4">End Date</span>
              <span className="text-base text-gray-200 shrink-0">{formatDate(customer.completionDate) || '—'}</span>
            </div>
          )}
          {customer.category.toLowerCase() === 'customer' && (
            <>
              <Field label="Start Date"  value={formatDate(customer.startDate)} />
              <Field label="Complete"    value={formatDate(customer.completionDate)} />
            </>
          )}
          <div className="flex items-center px-4 py-3 gap-4">
            <span className="text-sm text-gray-500 w-28 shrink-0">Date Added</span>
            <span className="text-base text-gray-200 flex-1 break-words">{formatDate(customer.creationDate) || '—'}</span>
            <span className="text-sm text-gray-500 shrink-0 ml-4">Last Update</span>
            <span className="text-base text-gray-200 shrink-0">{formatDate(customer.lastUpdateDate) || '—'}</span>
          </div>
          {customer.category.toLowerCase() === 'employee' && (
            <Field label="Birth Date" value={customer.birthDate} />
          )}
        </FieldGroup>

        {customer.comments && (
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Comments</p>
            <p className="text-sm text-gray-200 whitespace-pre-wrap">{customer.comments}</p>
          </div>
        )}
      </div>
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
