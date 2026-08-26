import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/pipeline',          label: 'Pipeline' },
  { to: '/jobs',              label: 'Jobs' },
  { to: '/proposals/pipeline', label: 'Proposals' },
  { to: '/invoices/pipeline',  label: 'Invoices' },
]

export default function PipelineJobsTabs() {
  return (
    <div className="flex gap-1.5 mb-4">
      {TABS.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              isActive ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
