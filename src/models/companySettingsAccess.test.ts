import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const src = (p: string) => strip(readFileSync(p, 'utf8'))

describe('company settings are owner/admin in the UI, matching firestore.rules', () => {
  it('only owner and admin get canManageCompany', () => {
    const perms = src('src/hooks/usePermissions.ts')
    const grantFor = (label: string) =>
      perms.slice(perms.indexOf(label)).match(/canManageCompany: (true|false)/)?.[1]
    expect(grantFor("case 'admin':")).toBe('true')      // owner falls through to admin
    expect(perms).toMatch(/case 'owner':\s*case 'admin':/)
    expect(grantFor("case 'salesman':")).toBe('false')
    expect(grantFor("case 'viewer':")).toBe('false')
    // Unknown roles — 'member', the default for invited teammates — fall through.
    expect(grantFor('default:')).toBe('false')
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
