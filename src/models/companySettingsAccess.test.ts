import { describe, it, expect, vi } from 'vitest'

vi.mock('../stores/authStore', () => ({ useAuthStore: vi.fn() }))
import { readFileSync } from 'node:fs'
import { resolvePermissions } from '../hooks/usePermissions'

const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const src = (p: string) => strip(readFileSync(p, 'utf8'))

describe('company settings are owner/admin in the UI, matching firestore.rules', () => {
  it('only owner and admin get canManageCompany', () => {
    for (const r of ['owner', 'admin']) expect(resolvePermissions(r).canManageCompany, r).toBe(true)
    for (const r of ['salesman', 'member', 'viewer', 'user', 'mystery'])
      expect(resolvePermissions(r).canManageCompany, r).toBe(false)
    expect(resolvePermissions(null, false).canManageCompany).toBe(false)   // still loading
  })

  it.each([
    'src/pages/quote/QuotePage.tsx',
    'src/pages/doctemplates/DocTemplatePreviewPage.tsx',
  ])('%s autosaves only the four letterhead fields, and only for owner/admin', p => {
    const fn = src(p).match(/function updateCo[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(fn).toMatch(/if \(!canManageCompany\) return/)
    expect(fn).toMatch(/saveCompanyProfile\(\{ name, address, phone, email \}\)/)
    expect(fn).not.toMatch(/saveCompanyProfile\(next\)/)
  })

  it('each company-config page is gated', () => {
    expect(src('src/pages/invoices/InvoiceDetailPage.tsx')).toMatch(/\{canManageCompany && \(\s*<button\s*onClick=\{\(\) => editCo/)
    expect(src('src/pages/automations/AutomationsPage.tsx')).toMatch(/disabled=\{savingReviewLink \|\| !canManageCompany\}/)
    expect(src('src/pages/smsinbox/SmsInboxPage.tsx')).toMatch(/disabled=\{saving \|\| !numberValid \|\| !canManageCompany\}/)
    expect(src('src/pages/pipeline/PipelineStagesPage.tsx')).toMatch(/<fieldset disabled=\{!canManageCompany\}/)
    expect(src('src/pages/targets/TargetsPage.tsx')).toMatch(/\{r\.rankable && canManageCompany && \(/)
  })

  it('the SMS page names the real reason a claim was refused', () => {
    expect(src('src/pages/smsinbox/SmsInboxPage.tsx')).toMatch(/is already connected to another company/)
  })
})
