import { describe, it, expect } from 'vitest'
import { runBulk, bulkResultMessage } from './bulkResult'

describe('runBulk', () => {
  it('reports every item as succeeded when all succeed', async () => {
    const out = await runBulk(['a', 'b', 'c'], async () => undefined)
    expect(out.succeeded).toEqual(['a', 'b', 'c'])
    expect(out.failed).toEqual([])
    expect(out.firstError).toBeNull()
  })

  it('keeps the successes when one operation fails', async () => {
    // Promise.all threw away this information entirely: one rejection and the
    // caller learned nothing about the other thirty-nine.
    const out = await runBulk(['a', 'b', 'c'], async id => {
      if (id === 'b') throw new Error('write denied')
    })
    expect(out.succeeded).toEqual(['a', 'c'])
    expect(out.failed).toEqual(['b'])
  })

  it('names exactly which items failed, so a retry can target them', async () => {
    const out = await runBulk([1, 2, 3, 4, 5], async n => {
      if (n % 2 === 0) throw new Error('nope')
    })
    expect(out.failed).toEqual([2, 4])
    expect(out.succeeded).toEqual([1, 3, 5])
  })

  it('keeps items aligned with their own result when operations settle out of order', async () => {
    // The first item resolves last. An index-free implementation would
    // mis-attribute the failure.
    const out = await runBulk(['slow', 'fast'], async id => {
      if (id === 'slow') {
        await new Promise(r => setTimeout(r, 20))
        throw new Error('slow failed')
      }
    })
    expect(out.failed).toEqual(['slow'])
    expect(out.succeeded).toEqual(['fast'])
  })

  it('surfaces the first rejection as an Error', async () => {
    const out = await runBulk(['a'], async () => { throw new Error('permission-denied') })
    expect(out.firstError).toBeInstanceOf(Error)
    expect(out.firstError?.message).toBe('permission-denied')
  })

  it('wraps a non-Error rejection rather than passing it through', async () => {
    const out = await runBulk(['a'], async () => { throw 'just a string' })
    expect(out.firstError).toBeInstanceOf(Error)
    expect(out.firstError?.message).toBe('just a string')
  })

  it('keeps the first rejection, not the last', async () => {
    const out = await runBulk(['a', 'b'], async id => { throw new Error(`fail-${id}`) })
    expect(out.firstError?.message).toBe('fail-a')
  })

  it('handles an empty selection without calling the operation', async () => {
    let calls = 0
    const out = await runBulk([], async () => { calls++ })
    expect(calls).toBe(0)
    expect(out).toEqual({ succeeded: [], failed: [], firstError: null })
  })

  it('reports every item as failed when all fail', async () => {
    const out = await runBulk(['a', 'b'], async () => { throw new Error('x') })
    expect(out.succeeded).toEqual([])
    expect(out.failed).toEqual(['a', 'b'])
  })
})

describe('bulkResultMessage', () => {
  const msg = (done: number, total: number, action = 'deleted') =>
    bulkResultMessage({ done, total, noun: 'invoice', action })

  it('states a plain count when everything succeeded', () => {
    expect(msg(40, 40)).toEqual({ text: '40 invoices deleted', variant: 'success' })
  })

  it('reports both halves of a partial run, as an error', () => {
    // The case the page used to render as an unqualified "Bulk delete failed".
    const r = msg(38, 40)
    expect(r.variant).toBe('error')
    expect(r.text).toContain('38 of 40 invoices deleted')
    expect(r.text).toContain('2 failed')
    expect(r.text).toContain('still selected')
  })

  it('says nothing went through when every operation failed', () => {
    const r = msg(0, 40)
    expect(r.variant).toBe('error')
    expect(r.text).toContain('all 40 failed')
    expect(r.text).toContain('still selected')
  })

  it('never claims success when anything failed', () => {
    for (const done of [0, 1, 19, 39]) {
      expect(msg(done, 40).variant).toBe('error')
    }
  })

  it('uses the singular noun for a single item', () => {
    expect(msg(1, 1).text).toBe('1 invoice deleted')
  })

  it('agrees in number when exactly one item failed', () => {
    expect(msg(1, 2).text).toContain('1 failed and is still selected')
    expect(msg(1, 3).text).toContain('2 failed and are still selected')
  })

  it('reads correctly for a multi-word action', () => {
    expect(bulkResultMessage({ done: 5, total: 5, noun: 'invoice', action: 'marked as Paid' }).text)
      .toBe('5 invoices marked as Paid')
  })

  it('handles an empty selection', () => {
    expect(msg(0, 0).variant).toBe('error')
  })
})
