import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fullName, type CustomerItem } from '../models/customer'

/**
 * Reads the `?customerId=` deep link that a customer's Related Records panel
 * emits, so a module page can scope its list to that one customer and — with
 * `&new=1` — open its create form already pointed at them.
 *
 * The record is resolved out of whatever customer list the page already
 * subscribes to for its own picker, not from the URL, so a renamed customer
 * shows its current name. `customerName` in the URL is only a fallback for the
 * moment before that subscription lands — and for pages like Service Requests
 * that don't subscribe to customers at all.
 */
export function useCustomerDeepLink(
  customers: CustomerItem[],
  onNew?: (c: CustomerItem) => void,
) {
  const [params, setParams] = useSearchParams()
  const customerId = params.get('customerId') ?? ''
  const urlName    = params.get('customerName') ?? ''
  const wantsNew   = params.get('new') === '1'

  const customer = useMemo(
    () => (customerId ? customers.find(c => c.id === customerId) ?? null : null),
    [customers, customerId],
  )

  // Fires once per deep-linked customer, once the record resolves. The ref
  // guard is what makes that "once": `onNew` is a fresh closure every render,
  // so without it the effect would reopen — and so reset — the form under
  // whatever the person had already typed into it.
  const opened = useRef('')
  useEffect(() => {
    // Reset once the link is gone, so arriving at the same deep link again —
    // browser Back after "Show all", say — reopens the form.
    if (!wantsNew) { opened.current = ''; return }
    if (!customer || opened.current === customer.id) return
    opened.current = customer.id
    onNew?.(customer)
  }, [wantsNew, customer, onNew])

  function clearScope() {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('customerId')
      next.delete('customerName')
      next.delete('new')
      return next
    }, { replace: true })
  }

  return {
    customerId,
    customerName: customer ? fullName(customer) : urlName,
    customer,
    isScoped: customerId !== '',
    clearScope,
  }
}
