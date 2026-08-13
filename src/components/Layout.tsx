import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useReminders } from '../hooks/useReminders'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import GlobalSearch from './GlobalSearch'
import RemindersPanel from './RemindersPanel'

// ─── Icon helper ──────────────────────────────────────────────────────────────

function ico(d: string) {
  return (cls: string) => (
    <svg className={cls} fill="none" viewBox="0 0 24 24"
         stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

type NavItem = { to: string; label: string; icon: (cls: string) => React.ReactNode }

// ─── Nav groups ───────────────────────────────────────────────────────────────

interface NavGroup {
  id: string
  label: string
  groupIcon: (cls: string) => React.ReactNode
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'crm',
    label: 'CRM',
    groupIcon: ico('M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z'),
    items: [
      { to: '/leads',     label: 'Leads',     icon: ico('M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z') },
      { to: '/customers', label: 'Customers', icon: ico('M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z') },
      { to: '/vendors',   label: 'Vendors',   icon: ico('M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z') },
      { to: '/employees', label: 'Employees', icon: ico('M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z') },
      { to: '/pipeline',  label: 'Pipeline',  icon: ico('M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0-3.75-3.75M17.25 21 21 17.25') },
      { to: '/callback',  label: 'Callbacks', icon: ico('M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z') },
      { to: '/duplicates', label: 'Duplicates', icon: ico('M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75') },
    ],
  },
  {
    id: 'sales',
    label: 'Sales & Finance',
    groupIcon: ico('M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'),
    items: [
      { to: '/jobs',       label: 'Jobs',       icon: ico('M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l5.653-4.655m5.833-4.329c.501-.553.666-1.109.422-1.634-.557-1.228-2.678-1.799-3.252-1.406-.574.393-.819 2.516-.819 2.516-.002.116-.016.23-.042.341m5.833-4.329.823-.823a1.125 1.125 0 0 1 1.591 1.591l-.823.82-5.833 4.33') },
      { to: '/invoices',   label: 'Invoices',   icon: ico('M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z') },
      { to: '/commission', label: 'Commission', icon: ico('M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z') },
      { to: '/targets',    label: 'Targets',   icon: ico('M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5') },
      { to: '/goals',      label: 'Goals',      icon: ico('M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5') },
      { to: '/expenses',   label: 'Expenses',   icon: ico('M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z') },
    ],
  },
  {
    id: 'outreach',
    label: 'Outreach',
    groupIcon: ico('M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5'),
    items: [
      { to: '/blast',        label: 'Blast',        icon: ico('M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5') },
      { to: '/followups',    label: 'Follow-ups',   icon: ico('M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99') },
      { to: '/appointments', label: 'Appointments', icon: ico('M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z') },
      { to: '/chat',         label: 'Chat',         icon: ico('M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z') },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    groupIcon: ico('M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z'),
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: ico('M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z') },
      { to: '/chart',     label: 'Charts',    icon: ico('M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z') },
      { to: '/reports',   label: 'Reports',   icon: ico('M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 7.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5Z') },
      { to: '/funnel',    label: 'Funnel',    icon: ico('M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75a48.096 48.096 0 0 1 3 0c1.536.071 2.25.864 2.25 1.89 0 .47-.156.92-.432 1.27m0 0a48.07 48.07 0 0 1-3 0m3 0a48.08 48.08 0 0 0 2.25.84A9.01 9.01 0 0 1 18 9.75M8.25 9.75a9 9 0 0 1 9 9') },
      { to: '/forecast',  label: 'Forecast',  icon: ico('M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941') },
      { to: '/heatmap',   label: 'Heat Map',  icon: ico('M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z') },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    groupIcon: ico('M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l5.653-4.655m5.833-4.329c.501-.553.666-1.109.422-1.634-.557-1.228-2.678-1.799-3.252-1.406-.574.393-.819 2.516-.819 2.516-.002.116-.016.23-.042.341m5.833-4.329.823-.823a1.125 1.125 0 0 1 1.591 1.591l-.823.82-5.833 4.33'),
    items: [
      { to: '/import',   label: 'Import',   icon: ico('M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5') },
      { to: '/batch',    label: 'Batch',    icon: ico('M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z') },
      { to: '/maps',     label: 'Maps',     icon: ico('M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z') },
      { to: '/calendar', label: 'Calendar', icon: ico('M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5') },
      { to: '/todo',          label: 'To-Do',        icon: ico('M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z') },
      { to: '/service-plans', label: 'Service Plans', icon: ico('M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99') },
      { to: '/activity',      label: 'Activity',     icon: ico('M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z') },
    ],
  },
  {
    id: 'system',
    label: 'System',
    groupIcon: ico('M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'),
    items: [
      { to: '/settings', label: 'Settings', icon: ico('M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z') },
      { to: '/tip',      label: 'Tip',      icon: ico('M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z') },
    ],
  },
]

// Flat list used for tab bar + sidebar map
const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items)

// ─── Main layout ──────────────────────────────────────────────────────────────

export default function Layout({ children }: { children: React.ReactNode }) {
  const signOut = useAuthStore(s => s.signOut)
  const user    = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const [showMore,      setShowMore]      = useState(false)
  const [showSearch,    setShowSearch]    = useState(false)
  const [showReminders, setShowReminders] = useState(false)
  const closeSearch = useCallback(() => setShowSearch(false), [])

  const moreSheetRef = useRef<HTMLDivElement>(null)
  useFocusTrap(moreSheetRef, showMore)

  const { items: reminderItems, urgentCount, permission, requestPermission } = useReminders()
  const { unreadCount, startWatch, stopWatch } = useChatStore()

  // Sidebar collapsed (icon-only) state
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('thelight.nav.collapsed') === '1'
  )

  // Favorites
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('thelight.nav.favorites')
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return []
  })

  useEffect(() => {
    localStorage.setItem('thelight.nav.favorites', JSON.stringify(favorites))
  }, [favorites])

  function toggleFavorite(to: string) {
    setFavorites(prev => prev.includes(to) ? prev.filter(t => t !== to) : [...prev, to])
  }

  const allItemsMap = useMemo(
    () => Object.fromEntries(ALL_ITEMS.map(item => [item.to, item])),
    []
  )

  // Mobile tab bar: first 4 favorites, padded with non-favorite items if needed
  const mobileTabs = useMemo(() => {
    if (favorites.length === 0) return ALL_ITEMS.slice(0, 4)
    const favItems = favorites
      .map(to => allItemsMap[to])
      .filter((item): item is NavItem => Boolean(item))
      .slice(0, 4)
    if (favItems.length >= 4) return favItems
    const favSet = new Set(favorites)
    const rest = ALL_ITEMS.filter(item => !favSet.has(item.to))
    return [...favItems, ...rest].slice(0, 4)
  }, [favorites, allItemsMap])

  // Which groups are open (expanded)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('thelight.nav.groups')
      if (raw) return new Set<string>(JSON.parse(raw))
    } catch { /* ignore */ }
    return new Set(NAV_GROUPS.map(g => g.id))
  })

  useEffect(() => {
    localStorage.setItem('thelight.nav.collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    localStorage.setItem('thelight.nav.groups', JSON.stringify([...openGroups]))
  }, [openGroups])

  function toggleGroup(id: string) {
    setOpenGroups(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  // Cmd+K global search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setShowSearch(v => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (user?.uid) startWatch(user.uid); else stopWatch()
    return () => stopWatch()
  }, [user?.uid])

  function navIcon(item: NavItem, cls: string) {
    if (item.to !== '/chat' || unreadCount === 0) return item.icon(cls)
    return (
      <div className="relative shrink-0">
        {item.icon(cls)}
        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 rounded-full border border-gray-900 flex items-center justify-center text-xs font-bold text-white leading-none">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      </div>
    )
  }

  const { canInstall, install, dismiss: dismissInstall } = useInstallPrompt()

  const isChatLog    = /^\/chat\/.+/.test(pathname)
  const isFullHeight = isChatLog || pathname === '/maps'

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const moreIsActive = !mobileTabs.some(item => pathname.startsWith(item.to))

  return (
    <div className="flex w-full overflow-hidden bg-gray-950" style={{ height: '100dvh' }}>

      {/* Skip to main content — visible only on keyboard focus */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-indigo-600 focus:text-white focus:px-3 focus:py-1.5 focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* ── Sidebar — desktop ── */}
      <aside
        className={`hidden md:flex flex-col shrink-0 bg-gray-900 border-r border-gray-800 transition-all duration-200 ${
          collapsed ? 'w-14' : 'w-56'
        }`}
      >
        {/* Header */}
        <div className={`border-b border-gray-800 ${collapsed ? 'flex flex-col items-center justify-center px-0 py-3 gap-2' : 'px-4 pt-3 pb-2'}`}>
          {/* Top row: title + icon buttons */}
          <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'justify-between'}`}>
            {!collapsed && (
              <span className="text-base font-bold text-white tracking-tight truncate">TheLight</span>
            )}
            <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'gap-0.5'}`}>
              {/* Collapse toggle */}
              <button
                onClick={() => setCollapsed(v => !v)}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="text-gray-500 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  {collapsed
                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                    : <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                  }
                </svg>
              </button>
              {/* Search */}
              <button
                onClick={() => setShowSearch(true)}
                title="Search (⌘K)"
                className="text-gray-500 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              </button>
              {/* Reminders */}
              <button
                onClick={() => setShowReminders(v => !v)}
                title="Reminders"
                className="relative text-gray-500 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                {urgentCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 rounded-full border border-gray-900 flex items-center justify-center text-xs font-bold text-white leading-none">
                    {urgentCount > 9 ? '9+' : urgentCount}
                  </span>
                )}
              </button>
              {/* Sign out — collapsed icon */}
              {collapsed && (
                <button
                  onClick={handleSignOut}
                  title="Sign Out"
                  className="text-gray-500 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          {/* Sign out + collapse-all — expanded, below title */}
          {!collapsed && (
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-1.5 text-xs text-white hover:text-gray-300 px-0.5 py-1 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
                </svg>
                Sign Out
              </button>
              <button
                onClick={() => setOpenGroups(new Set())}
                title="Collapse all sections"
                className="flex items-center gap-1.5 text-xs text-white hover:text-gray-300 px-0.5 py-1 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
                </svg>
                Collapse All
              </button>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">

          {/* ── Favorites group ── */}
          {!collapsed && (
            <div className="mb-1">
              <div className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg mx-1 text-yellow-400">
                <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wider flex-1">Favorites</span>
              </div>

              <div className="mt-0.5 space-y-0.5 px-2">
                {favorites.length === 0 && (
                  <p className="px-3 py-1.5 text-xs text-gray-600 italic">
                    Hover any menu item and click ★ to pin it here
                  </p>
                )}
                {favorites.map(to => {
                  const item = allItemsMap[to]
                  if (!item) return null
                  return (
                    <div key={to} className="relative group/fav">
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 px-3 py-2 pr-8 rounded-lg text-sm font-medium transition-colors ${
                            isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                          }`
                        }
                      >
                        {navIcon(item, 'w-4 h-4 shrink-0')}
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                      <button
                        onClick={() => toggleFavorite(to)}
                        title="Remove from favorites"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-yellow-400 opacity-0 group-hover/fav:opacity-100 hover:text-yellow-300 transition-opacity"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="mx-3 my-1 border-t border-yellow-900/40" />
            </div>
          )}

          {NAV_GROUPS.map(group => {
            const isOpen = openGroups.has(group.id)

            return (
              <div key={group.id} className="mb-1">
                {/* Group header */}
                <button
                  onClick={() => collapsed ? setCollapsed(false) : toggleGroup(group.id)}
                  title={collapsed ? group.label : undefined}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors rounded-lg mx-1 ${
                    isOpen ? 'text-indigo-400' : 'text-white hover:text-gray-200'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  {group.groupIcon(collapsed ? 'w-5 h-5 shrink-0' : 'w-4 h-4 shrink-0')}
                  {!collapsed && (
                    <>
                      <span className="text-xs font-semibold uppercase tracking-wider flex-1">
                        {group.label}
                      </span>
                      <svg
                        className={`w-3 h-3 transition-transform shrink-0 ${isOpen ? '' : '-rotate-90'}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                      </svg>
                    </>
                  )}
                </button>

                {/* Group items */}
                {!collapsed && isOpen && (
                  <div className="mt-0.5 space-y-0.5 px-2">
                    {group.items.map(item => {
                      const isFav = favorites.includes(item.to)
                      return (
                        <div key={item.to} className="relative group/nav">
                          <NavLink
                            to={item.to}
                            className={({ isActive }) =>
                              `flex items-center gap-2.5 px-3 py-2 pr-8 rounded-lg text-sm font-medium transition-colors ${
                                isActive
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                              }`
                            }
                          >
                            {navIcon(item, 'w-4 h-4 shrink-0')}
                            <span className="truncate">{item.label}</span>
                          </NavLink>
                          <button
                            onClick={() => toggleFavorite(item.to)}
                            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                            className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded transition-all hover:text-yellow-300 ${
                              isFav
                                ? 'text-yellow-400 opacity-100'
                                : 'text-gray-600 opacity-0 group-hover/nav:opacity-100 group-hover/nav:text-gray-400'
                            }`}
                          >
                            <svg className="w-3 h-3" fill={isFav ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                            </svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Icon-only: show items as icon row */}
                {collapsed && (
                  <div className="flex flex-col items-center gap-0.5 mt-0.5 px-1 pb-1">
                    {group.items.map(item => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        title={item.label}
                        className={({ isActive }) =>
                          `flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                            isActive
                              ? 'bg-indigo-600 text-white'
                              : 'text-gray-500 hover:text-gray-100 hover:bg-gray-800'
                          }`
                        }
                      >
                        {navIcon(item, 'w-4 h-4')}
                      </NavLink>
                    ))}
                  </div>
                )}

                {/* Divider between groups (collapsed mode: subtle line) */}
                {collapsed && (
                  <div className="mx-3 my-1 border-t border-gray-800" />
                )}
              </div>
            )
          })}

        </nav>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile top bar */}
        <div
          className="md:hidden flex items-center justify-between px-4 bg-gray-900 border-b border-gray-800"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '8px' }}
        >
          <span className="text-sm font-semibold text-white">TheLight</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowSearch(true)} className="text-gray-400 hover:text-white p-1.5 rounded transition-colors" aria-label="Search">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </button>
            <button onClick={() => setShowReminders(v => !v)} aria-label="Reminders" className="relative text-gray-400 hover:text-white p-1.5 rounded transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
              {urgentCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 rounded-full border border-gray-900 flex items-center justify-center text-xs font-bold text-white leading-none">
                  {urgentCount > 9 ? '9+' : urgentCount}
                </span>
              )}
            </button>
            <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded">Sign Out</button>
          </div>
        </div>

        <main id="main-content" className={`flex-1 ${isFullHeight ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
          {children}
        </main>

        {/* PWA install banner — Android Chrome only, dismissed via localStorage */}
        {canInstall && (
          <div className="md:hidden flex items-center gap-3 px-4 py-2.5 bg-indigo-950 border-t border-indigo-800/60">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-indigo-100 truncate">Add TheLight to your home screen</p>
            </div>
            <button
              onClick={install}
              className="shrink-0 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Install
            </button>
            <button
              onClick={dismissInstall}
              aria-label="Dismiss install banner"
              className="shrink-0 text-indigo-400 hover:text-indigo-200 p-1 -mr-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden flex border-t border-gray-800 bg-gray-900" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
          {mobileTabs.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-xs font-medium transition-colors ${
                  isActive ? 'text-indigo-400' : 'text-gray-500'
                }`
              }
            >
              {navIcon(item, 'w-5 h-5')}
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setShowMore(true)}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-xs font-medium transition-colors ${
              moreIsActive ? 'text-indigo-400' : 'text-gray-500'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <span>More</span>
          </button>
        </nav>
      </div>

      {/* Global search modal */}
      {showSearch && <GlobalSearch onClose={closeSearch} />}

      {/* Reminders panel */}
      {showReminders && (
        <RemindersPanel
          items={reminderItems}
          permission={permission}
          onRequestPermission={requestPermission}
          onClose={() => setShowReminders(false)}
        />
      )}

      {/* Mobile "More" sheet — grouped */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowMore(false)} />
          <div
            ref={moreSheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="more-sheet-title"
            className="relative bg-gray-900 rounded-t-2xl border-t border-gray-700 px-4 pt-4 max-h-[80vh] overflow-y-auto"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
          >
            <div className="w-10 h-1 bg-gray-600 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3">
              <span id="more-sheet-title" className="text-sm font-semibold text-white">Menu</span>
              <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded">Sign Out</button>
            </div>
            {NAV_GROUPS.map(group => (
              <div key={group.id} className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 px-1">
                  {group.label}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {group.items.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setShowMore(false)}
                      className={({ isActive }) =>
                        `flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl text-xs font-medium transition-colors ${
                          isActive ? 'bg-indigo-600/30 text-indigo-300' : 'bg-gray-800 text-gray-300'
                        }`
                      }
                    >
                      {navIcon(item, 'w-5 h-5')}
                      <span className="text-center leading-tight">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
