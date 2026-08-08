import { Link } from 'react-router-dom'
import { fullName, formatCurrency, type CustomerItem } from '../models/customer'

const CATEGORY_COLORS: Record<string, string> = {
  Lead: 'text-indigo-400',
  Customer: 'text-indigo-400',
  Vendor: 'text-purple-400',
  Employee: 'text-cyan-400',
}

interface Props {
  customer: CustomerItem
  showCategory?: boolean
}

export default function CustomerCard({ customer, showCategory }: Props) {
  const name = fullName(customer)
  const initials = [customer.first[0], customer.lastname[0]].filter(Boolean).join('').toUpperCase()

  return (
    <Link
      to={`/records/${customer.id}`}
      className="card flex items-center gap-4 p-4 hover:bg-gray-700/50 transition-colors"
    >
      {/* Avatar */}
      {customer.photo ? (
        <img
          src={customer.photo}
          alt={name}
          className="w-11 h-11 rounded-full object-cover shrink-0 bg-gray-700"
        />
      ) : (
        <div className="w-11 h-11 rounded-full bg-indigo-700/40 flex items-center justify-center shrink-0">
          <span className="text-sm font-semibold text-indigo-300">{initials || '?'}</span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-gray-100 truncate">{name || '—'}</span>
          {!customer.isActive && (
            <span className="text-xs text-gray-500 shrink-0">inactive</span>
          )}
        </div>
        {(customer.city || customer.state) && (
          <p className="text-sm text-gray-400 truncate">
            {[customer.city, customer.state].filter(Boolean).join(', ')}
          </p>
        )}
        {customer.phone && (
          <p className="text-xs text-gray-500 truncate">{customer.phone}</p>
        )}
      </div>

      <div className="shrink-0 text-right">
        {customer.amount > 0 && (
          <p className="text-sm font-semibold text-green-400">
            {formatCurrency(customer.amount)}
          </p>
        )}
        {showCategory && customer.category && (
          <p className={`text-xs font-medium ${CATEGORY_COLORS[customer.category] ?? 'text-gray-400'}`}>
            {customer.category}
          </p>
        )}
        {customer.salesman && (
          <p className="text-xs text-gray-500">{customer.salesman}</p>
        )}
      </div>
    </Link>
  )
}
