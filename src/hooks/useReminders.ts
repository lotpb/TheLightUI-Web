import { useEffect, useRef, useState } from 'react'
import { subscribeToFollowUps } from '../services/customerService'
import { fullName, type CustomerItem } from '../models/customer'
import { useAuthStore } from '../stores/authStore'

const NOTIFY_AHEAD_MS = 60 * 60 * 1_000 // fire browser notification within 1 hour

export function useReminders() {
  const companyId = useAuthStore(s => s.companyId)
  const [items, setItems]         = useState<CustomerItem[]>([])
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  )
  const notifiedIds = useRef(new Set<string>())

  useEffect(() => {
    const unsub = subscribeToFollowUps(setItems, () => {})
    return unsub
  }, [companyId])

  // Fire browser notifications for items due within the next hour
  useEffect(() => {
    if (permission !== 'granted') return
    function check() {
      const now = Date.now()
      for (const c of items) {
        if (!c.followUpDate) continue
        const diff = c.followUpDate.getTime() - now
        if (diff >= 0 && diff <= NOTIFY_AHEAD_MS && !notifiedIds.current.has(c.id)) {
          notifiedIds.current.add(c.id)
          const minutes = Math.round(diff / 60_000)
          new Notification(minutes <= 1 ? 'Follow-up now!' : `Follow-up in ${minutes}m`, {
            body: fullName(c) || 'Customer follow-up',
            icon: '/favicon.ico',
            tag: c.id,
          })
        }
      }
    }
    check()
    const id = setInterval(check, 60_000)
    return () => clearInterval(id)
  }, [items, permission])

  async function requestPermission() {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
  }

  // Count overdue + today as "urgent" for the badge
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const urgentCount = items.filter(c => c.followUpDate && c.followUpDate <= endOfToday).length

  return { items, urgentCount, permission, requestPermission }
}
