import { describe, it, expect, vi } from 'vitest'

vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('../stores/authStore', () => ({ getCompanyId: () => 'co1' }))
import { readFileSync } from 'node:fs'
import { importConfirmMessage } from './backupImport'
import { mergePickerEdits, type PickerLists } from '../services/pickerService'
import { restoredFirestoreKeys, customerToFirestore, emptyCustomer } from './customer'

const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const lists = (o: Partial<PickerLists>): PickerLists =>
  ({ salesman: [], job: [], product: [], advertiser: [], contractor: [], ...o })

describe('dropdown list save merges instead of replacing', () => {
  it("keeps another admin's additions made while the page was open", () => {
    const base = lists({ salesman: ['Ann', 'Bo'] })
    const mine = lists({ salesman: ['Ann', 'Bo', 'Cy'] })
    const theirs = lists({ salesman: ['Ann', 'Bo', 'Dee'] })
    expect(mergePickerEdits(base, mine, theirs).salesman).toEqual(['Ann', 'Bo', 'Dee', 'Cy'])
  })

  it("applies this page's removals without resurrecting or dropping others", () => {
    const base = lists({ job: ['Roof', 'Siding', 'Gutter'] })
    const mine = lists({ job: ['Roof', 'Gutter'] })
    const theirs = lists({ job: ['Roof', 'Siding', 'Gutter', 'Deck'] })
    expect(mergePickerEdits(base, mine, theirs).job).toEqual(['Roof', 'Gutter', 'Deck'])
  })

  it('does not duplicate an item both sides added', () => {
    const r = mergePickerEdits(lists({}), lists({ product: ['X'] }), lists({ product: ['X'] }))
    expect(r.product).toEqual(['X'])
  })

  it('a label is written only when this page renamed it', () => {
    const base = lists({ labels: {} })
    const theirs = lists({ labels: { job: 'Service' } })
    expect(mergePickerEdits(base, lists({ labels: { salesman: 'Salesman', job: 'Job Type' } }), theirs).labels)
      .toEqual({ job: 'Service' })
    expect(mergePickerEdits(base, lists({ labels: { salesman: 'Rep' } }), theirs).labels)
      .toEqual({ job: 'Service', salesman: 'Rep' })
  })
})

describe('JSON restore writes only what the backup holds', () => {
  it('maps backup keys to their Firestore names and skips id', () => {
    const keys = restoredFirestoreKeys({ id: 'x', isActive: true, quantity: 2, startDate: '', lastname: 'R' })
    expect([...keys].sort()).toEqual(['active', 'lastname', 'quan', 'start'])
  })

  it('a backup never supplies the fields a restore used to wipe', () => {
    // A real iOS-shaped record: nothing here should let a restore touch these.
    const rec = JSON.parse(JSON.stringify({ id: 'c1', isActive: true, first: 'A', lastname: 'B', street: '', city: '',
      state: '', zip: '', amount: 0, creationDate: '', rate: '', phone: '', comments: '', spouse: '', email: '',
      contractor: '', photo: '', lastUpdateDate: '', startDate: '', completionDate: '', quantity: 0, salesman: '',
      job: '', product: '', category: '', callback: '', adNo: '', tags: [], employeeStatus: '' }))
    const keys = restoredFirestoreKeys(rec)
    for (const k of ['smsOptOut', 'emailOptOut', 'portalToken', 'customFields', 'assignedToUid', 'createdByUid', 'pipelineStage', 'quoteNotes', 'followUpDate'])
      expect(keys.has(k), k).toBe(false)
    // …and every key it does supply is one customerToFirestore writes.
    const written = new Set(Object.keys(customerToFirestore({ ...emptyCustomer(), category: 'Lead' } as never)))
    for (const k of keys) expect(written.has(k), k).toBe(true)
  })

  it('the importer merges id-carrying records and keeps full writes for new ones', () => {
    const src = strip(readFileSync('src/services/customerService.ts', 'utf8'))
    const fn = src.slice(src.indexOf('export async function importCustomersFromJSON'), src.indexOf('export async function importCustomersFromCSVRows'))
    expect(fn).toMatch(/batch\.set\(doc\(db, COLLECTION, r\.id\), merged, \{ merge: true \}\)/)
    expect(fn).toMatch(/batch\.set\(doc\(collection\(db, COLLECTION\)\), data\)/)
    expect(fn).toMatch(/tags: Array\.isArray\(r\.tags\)/)
  })
})

describe('import confirmation', () => {
  it('says how many, from which file, and that ID matches update live records', () => {
    expect(importConfirmMessage({ kind: 'records', count: 120, withIds: 120, fileName: 'CustomerBackup.json' }))
      .toBe("Import 120 records from CustomerBackup.json into your company? All of them carry an ID: any that already exist are updated with the file's values (fields the file doesn’t have are kept). This can’t be undone.")
    expect(importConfirmMessage({ kind: 'todos', count: 1, withIds: 0, fileName: 't.json' }))
      .toBe('Import 1 todo from t.json into your company? This can’t be undone.')
    expect(importConfirmMessage({ kind: 'expenses', count: 5, withIds: 2, fileName: 'e.json' }))
      .toContain("2 carry an ID: any that already exist are updated with the file's values.")
  })
})

describe('Settings page wiring', () => {
  const src = strip(readFileSync('src/pages/SettingsPage.tsx', 'utf8'))

  it('choosing a file only stages it; the import runs from the confirmation', () => {
    const handler = src.slice(src.indexOf('async function handleImportFile'), src.indexOf('async function runImport'))
    expect(handler).not.toMatch(/import(Customers|Expenses|Todos)FromJSON/)
    expect(handler).toMatch(/setPendingImport\(/)
    expect(src).toMatch(/onConfirm=\{\(\) => pendingImport && runImport\(pendingImport\)\}/)
  })

  it('import and export follow the same permissions as the records list', () => {
    expect(src).toMatch(/perms\.canImport && <><button/)
    expect(src).toMatch(/perms\.canBulkAction && <button/)
  })

  it('viewers get no list, field or import controls', () => {
    expect(src).toMatch(/!perms\.isReadOnly && <SectionCard/)
    expect(src).toMatch(/!perms\.isReadOnly && <div className="border-t/)
  })

  it('lists save through the merge, and the sync claim no longer promises devices', () => {
    expect(src).toMatch(/savePickerListEdits\(lists, \{ \.\.\.local, labels: localLabels \}\)/)
    expect(src).not.toMatch(/savePickerLists\(/)
    expect(src).not.toMatch(/sync to all devices/)
  })

  it('a failed custom-field rename is reported', () => {
    const fn = src.slice(src.indexOf('async function saveEditField'), src.indexOf('async function handleDeleteCustomField'))
    expect(fn).toMatch(/catch \{\s*toast\(/)
  })
})
