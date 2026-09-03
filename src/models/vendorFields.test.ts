import { describe, it, expect } from 'vitest'
import { vendorFields, emptyCustomer, type CustomerItem } from './customer'

function vendor(over: Partial<CustomerItem> = {}): CustomerItem {
    return { ...emptyCustomer(), category: 'Vendor', ...over }
}

// Vendor records reuse two fields for different things than Lead/Customer do.
// Reading them by their raw names produced two shipped bugs: the /vendors
// Callback filter compared a manager's NAME to 'yes', and the printout got a
// "Salesman" column full of Yes/No. These tests pin the mapping down.
describe('vendorFields', () => {
    it('reads the callback flag out of `salesman`', () => {
        expect(vendorFields(vendor({ salesman: 'Yes' })).callbackFlag).toBe('Yes')
    })

    it('reads the manager name out of `callback`', () => {
        expect(vendorFields(vendor({ callback: 'Dana P' })).manager).toBe('Dana P')
    })

    it('does not cross the two fields', () => {
        const f = vendorFields(vendor({ salesman: 'Yes', callback: 'Dana P' }))
        expect(f).toEqual({ callbackFlag: 'Yes', manager: 'Dana P' })
        // The bug this guards: manager must never be a yes/no flag.
        expect(f.manager).not.toBe('Yes')
        expect(f.callbackFlag).not.toBe('Dana P')
    })

    it('passes empty fields through untouched', () => {
        expect(vendorFields(vendor())).toEqual({ callbackFlag: '', manager: '' })
    })

    it('accepts any record carrying the two fields', () => {
        // Typed as a Pick, so callers don't need a whole CustomerItem.
        expect(vendorFields({ salesman: 'No', callback: 'Sam' })).toEqual({
            callbackFlag: 'No',
            manager: 'Sam',
        })
    })
})
