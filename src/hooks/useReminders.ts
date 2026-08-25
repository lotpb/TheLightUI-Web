import { useEffect, useRef, useState } from 'react'
import { subscribeToFollowUps } from '../services/customerService'
import { subscribeToTodos } from '../services/todoService'
import { subscribeToServicePlans } from '../services/servicePlanService'
import { subscribeToInvoices } from '../services/invoiceService'
import { useSharedCustomers } from './useSharedCustomers'
import { fullName, type CustomerItem } from '../models/customer'
import type { Todo } from '../models/todo'
import type { ServicePlan } from '../models/servicePlan'
import type { Invoice } from '../models/invoice'
import { useAuthStore } from '../stores/authStore'
import { registerPush, listenForegroundMessages } from '../services/pushNotificationService'
import { useToast } from '../components/Toast'

export type NotifType = 'followup' | 'task' | 'serviceplan' | 'appointment'

export interface RecentActivity {
  id: string
  label: string
  sub: string
  linkTo: string
  createdAt: Date
  kind: 'lead' | 'customer' | 'invoice'
}

export interface Notification {
  id: string
  type: NotifType
  title: string
  subtitle: string
  dueDate: Date
  linkTo: string
  urgency: 'overdue' | 'today' | 'tomorrow' | 'soon'  // soon = within 7 days
}

const NOTIFY_AHEAD_MS = 60 * 60 * 1_000

function urgencyFor(date: Date): Notification['urgency'] | null {
  const now      = new Date()
  const today    = new Date(now); today.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  const tomorrowEnd = new Date(today); tomorrowEnd.setDate(today.getDate() + 1); tomorrowEnd.setHours(23, 59, 59, 999)
  const weekEnd  = new Date(today); weekEnd.setDate(today.getDate() + 7); weekEnd.setHours(23, 59, 59, 999)
  if (date < today)          return 'overdue'
  if (date <= todayEnd)      return 'today'
  if (date <= tomorrowEnd)   return 'tomorrow'
  if (date <= weekEnd)       return 'soon'
  return null  // beyond 7 days — don't surface
}

export function useReminders() {
  const companyId = useAuthStore(s => s.companyId)
  const user      = useAuthStore(s => s.user)
  const isReady   = useAuthStore(s => s.isReady)
  const toast     = useToast()

  const [followUps,    setFollowUps]    = useState<CustomerItem[]>([])
  const [todos,        setTodos]        = useState<Todo[]>([])
  const [servicePlans, setServicePlans] = useState<ServicePlan[]>([])
  const { items: allCustomers } = useSharedCustomers()
  const [allInvoices,  setAllInvoices]  = useState<Invoice[]>([])

  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  )
  const notifiedIds = useRef(new Set<string>())

  useEffect(() => {
    const unsub = subscribeToFollowUps(setFollowUps, () => {})
    return unsub
  }, [companyId])

  useEffect(() => {
    if (!user || !isReady) return
    const unsub = subscribeToTodos(
      items => setTodos(items.filter(t => !t.isCompleted && t.dueDate !== null)),
      () => {},
    )
    return unsub
  }, [user?.uid, isReady])

  useEffect(() => {
    if (!isReady) return
    const unsub = subscribeToServicePlans(
      plans => setServicePlans(plans.filter(p => p.isActive)),
      () => {},
    )
    return unsub
  }, [companyId, isReady])

  useEffect(() => {
    if (!isReady) return
    const unsub = subscribeToInvoices(setAllInvoices, () => {})
    return unsub
  }, [companyId, isReady])

  // Build unified notification list
  const notifications: Notification[] = []

  for (const c of followUps) {
    if (!c.followUpDate) continue
    const urgency = urgencyFor(c.followUpDate)
    if (!urgency) continue
    notifications.push({
      id:       `followup-${c.id}`,
      type:     'followup',
      title:    fullName(c) || 'Customer',
      subtitle: c.phone || c.city || '',
      dueDate:  c.followUpDate,
      linkTo:   `/records/${c.id}`,
      urgency,
    })
  }

  for (const t of todos) {
    if (!t.dueDate) continue
    const urgency = urgencyFor(t.dueDate)
    if (!urgency) continue
    notifications.push({
      id:       `task-${t.id}`,
      type:     'task',
      title:    t.title,
      subtitle: t.priority === 'high' ? 'High priority' : t.priority === 'medium' ? 'Medium priority' : '',
      dueDate:  t.dueDate,
      linkTo:   `/todo/${t.id}/edit`,
      urgency,
    })
  }

  for (const sp of servicePlans) {
    const urgency = urgencyFor(sp.nextDate)
    if (!urgency) continue
    notifications.push({
      id:       `sp-${sp.id}`,
      type:     'serviceplan',
      title:    sp.customerName,
      subtitle: sp.title,
      dueDate:  sp.nextDate,
      linkTo:   `/service-plans`,
      urgency,
    })
  }

  // Appointments — leads with an upcoming startDate
  for (const c of allCustomers) {
    if (c.category.toLowerCase() !== 'lead') continue
    const d = c.startDate
    if (!d || isNaN(d.getTime()) || d.getFullYear() < 2000) continue
    const urgency = urgencyFor(d)
    if (!urgency) continue
    notifications.push({
      id:       `appt-${c.id}`,
      type:     'appointment',
      title:    fullName(c) || 'Lead',
      subtitle: c.salesman ? `with ${c.salesman}` : c.phone || '',
      dueDate:  d,
      linkTo:   `/records/${c.id}`,
      urgency,
    })
  }

  // Recent activity — records and invoices created in the last 24 hours
  const yesterday24 = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentActivity: RecentActivity[] = []

  for (const c of allCustomers) {
    if (c.creationDate && c.creationDate >= yesterday24) {
      recentActivity.push({
        id:        `new-${c.id}`,
        label:     fullName(c) || 'New record',
        sub:       `New ${c.category.toLowerCase()} added`,
        linkTo:    `/records/${c.id}`,
        createdAt: c.creationDate,
        kind:      c.category.toLowerCase() === 'customer' ? 'customer' : 'lead',
      })
    }
  }

  for (const inv of allInvoices) {
    if (inv.createdAt && inv.createdAt >= yesterday24) {
      recentActivity.push({
        id:        `inv-${inv.id}`,
        label:     `Invoice ${inv.invoiceNumber}`,
        sub:       `${inv.customerName} · ${inv.status}`,
        linkTo:    `/invoices/${inv.id}`,
        createdAt: inv.createdAt,
        kind:      'invoice',
      })
    }
  }

  recentActivity.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  // Sort: overdue → today → tomorrow → soon, then by date
  const URGENCY_ORDER: Record<Notification['urgency'], number> = {
    overdue: 0, today: 1, tomorrow: 2, soon: 3,
  }
  notifications.sort((a, b) => {
    const uDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
    return uDiff !== 0 ? uDiff : a.dueDate.getTime() - b.dueDate.getTime()
  })

  // Browser notifications for follow-ups due within 1 hour
  useEffect(() => {
    if (permission !== 'granted') return
    function check() {
      const now = Date.now()
      for (const c of followUps) {
        if (!c.followUpDate) continue
        const diff = c.followUpDate.getTime() - now
        if (diff >= 0 && diff <= NOTIFY_AHEAD_MS && !notifiedIds.current.has(c.id)) {
          notifiedIds.current.add(c.id)
          const minutes = Math.round(diff / 60_000)
          new Notification(minutes <= 1 ? 'Follow-up now!' : `Follow-up in ${minutes}m`, {
            body: fullName(c) || 'Customer follow-up',
            icon: '/favicon.ico',
            tag:  c.id,
          })
        }
      }
    }
    check()
    const id = setInterval(check, 60_000)
    return () => clearInterval(id)
  }, [followUps, permission])

  // Once permission is granted (now or previously), keep this device's FCM
  // token registered — covers token rotation and first run after this feature
  // shipped for users who'd already granted permission.
  useEffect(() => {
    if (permission !== 'granted' || !user) return
    registerPush(user.uid).catch(() => {})
  }, [permission, user?.uid])

  // Foreground pushes (e.g. new chat messages) don't show a native notification,
  // so surface them as a toast instead.
  useEffect(() => {
    let unsub: (() => void) | undefined
    listenForegroundMessages(payload => {
      const title = payload.notification?.title ?? 'New notification'
      const body  = payload.notification?.body
      toast(body ? `${title} — ${body}` : title, 'info')
    }).then(fn => { unsub = fn })
    return () => unsub?.()
  }, [toast])

  async function requestPermission() {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted' && user) {
      registerPush(user.uid).catch(() => {})
    }
  }

  const urgentCount = notifications.filter(n => n.urgency === 'overdue' || n.urgency === 'today').length

  return { notifications, urgentCount, recentActivity, permission, requestPermission }
}
