import { useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { importCustomersFromCSVRows } from '../../services/customerService'
import { emptyCustomer, CATEGORIES, type CustomerItem } from '../../models/customer'

// ─── CSV parser ───────────────────────────────────────────────────────────────

function splitRow(line: string): string[] {
  const cols: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { cols.push(cur); cur = '' }
    else { cur += ch }
  }
  cols.push(cur)
  return cols.map(s => s.trim().replace(/^"|"$/g, ''))
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = splitRow(lines[0])
  const rows = lines.slice(1).map(l => {
    const cells = splitRow(l)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  }).filter(r => Object.values(r).some(v => v))
  return { headers, rows }
}

// ─── Field definitions ────────────────────────────────────────────────────────

interface FieldDef {
  key: string
  label: string
  required?: boolean
}

const FIELDS: FieldDef[] = [
  { key: 'first',      label: 'First Name',  required: true },
  { key: 'lastname',   label: 'Last Name' },
  { key: 'phone',      label: 'Phone' },
  { key: 'email',      label: 'Email' },
  { key: 'street',     label: 'Street' },
  { key: 'city',       label: 'City' },
  { key: 'state',      label: 'State' },
  { key: 'zip',        label: 'ZIP' },
  { key: 'amount',     label: 'Amount ($)' },
  { key: 'category',   label: 'Category' },
  { key: 'salesman',   label: 'Salesman' },
  { key: 'job',        label: 'Job' },
  { key: 'product',    label: 'Product' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'adNo',       label: 'Ad / Source' },
  { key: 'callback',   label: 'Callback' },
  { key: 'comments',   label: 'Notes' },
  { key: 'spouse',     label: 'Spouse' },
  { key: 'rate',       label: 'Rate' },
]

// Best-guess column matching from header names
function autoDetect(headers: string[]): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normed = headers.map(norm)
  const aliases: Record<string, string[]> = {
    first:      ['first', 'firstname', 'fname', 'givenname', 'name'],
    lastname:   ['last', 'lastname', 'lname', 'surname', 'familyname'],
    phone:      ['phone', 'telephone', 'mobile', 'cell', 'phonenumber', 'ph'],
    email:      ['email', 'emailaddress', 'mail', 'emailid'],
    street:     ['street', 'address', 'streetaddress', 'addr', 'address1'],
    city:       ['city', 'town'],
    state:      ['state', 'province', 'region', 'statecode'],
    zip:        ['zip', 'zipcode', 'postal', 'postalcode', 'postcode'],
    amount:     ['amount', 'price', 'total', 'value', 'revenue', 'sale', 'sales', 'jobamount'],
    category:   ['category', 'type', 'recordtype', 'customertype'],
    salesman:   ['salesman', 'rep', 'salesrep', 'agent', 'assignedto', 'agent'],
    job:        ['job', 'jobtitle', 'position', 'service', 'title', 'jobtype'],
    product:    ['product', 'item', 'productname', 'producttype'],
    contractor: ['contractor', 'installer', 'subcontractor'],
    adNo:       ['adno', 'ad', 'source', 'leadsource', 'advertiser', 'leadource'],
    callback:   ['callback', 'called', 'contacted'],
    comments:   ['comments', 'notes', 'note', 'comment', 'remarks', 'description'],
    spouse:     ['spouse', 'partner', 'spousename'],
    rate:       ['rate', 'rating'],
  }
  const result: Record<string, string> = {}
  for (const [field, list] of Object.entries(aliases)) {
    for (let i = 0; i < normed.length; i++) {
      if (list.includes(normed[i])) { result[field] = headers[i]; break }
    }
  }
  return result
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'map' | 'importing' | 'done'

export default function ImportPage() {
  usePageTitle('CSV Import')

  const [step, setStep]       = useState<Step>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows]       = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [defaultCat, setDefaultCat] = useState('Lead')
  const [progress, setProgress] = useState(0)
  const [result, setResult]   = useState<{ imported: number; skipped: number } | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv') && !file.type.includes('csv')) {
      setError('Please upload a .csv file.')
      return
    }
    setError(null)
    const text = await file.text()
    const parsed = parseCSV(text)
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError('The file appears to be empty or has no data rows.')
      return
    }
    setHeaders(parsed.headers)
    setRows(parsed.rows)
    setMapping(autoDetect(parsed.headers))
    setStep('map')
  }, [])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function setMap(field: string, col: string) {
    setMapping(m => ({ ...m, [field]: col }))
  }

  async function handleImport() {
    setStep('importing')
    setProgress(0)
    setError(null)

    const get = (row: Record<string, string>, field: string) =>
      (mapping[field] ? (row[mapping[field]] ?? '') : '').trim()

    const toImport: Omit<CustomerItem, 'id'>[] = []
    let skipped = 0

    for (const row of rows) {
      const first    = get(row, 'first')
      const lastname = get(row, 'lastname')
      const phone    = get(row, 'phone')
      if (!first && !lastname && !phone) { skipped++; continue }

      const rawCat = get(row, 'category')
      const cat = CATEGORIES.find(c => c.toLowerCase() === rawCat.toLowerCase()) ?? defaultCat as typeof CATEGORIES[number]

      const base = emptyCustomer()
      const { id: _id, ...rest } = base
      toImport.push({
        ...rest,
        first,
        lastname,
        phone,
        email:       get(row, 'email'),
        street:      get(row, 'street'),
        city:        get(row, 'city'),
        state:       get(row, 'state'),
        zip:         get(row, 'zip'),
        amount:      parseFloat(get(row, 'amount').replace(/[^0-9.]/g, '')) || 0,
        category:    cat,
        salesman:    get(row, 'salesman'),
        job:         get(row, 'job'),
        product:     get(row, 'product'),
        contractor:  get(row, 'contractor'),
        adNo:        get(row, 'adNo'),
        callback:    get(row, 'callback').toLowerCase() === 'yes' ? 'yes' : 'no',
        comments:    get(row, 'comments'),
        spouse:      get(row, 'spouse'),
        rate:        get(row, 'rate'),
        isActive:    true,
        creationDate:    new Date(),
        lastUpdateDate:  new Date(),
      })
    }

    if (toImport.length === 0) {
      setError('No valid rows found. Make sure "First Name" is mapped and at least one row has data.')
      setStep('map')
      return
    }

    try {
      const CHUNK = 100
      let done = 0
      for (let i = 0; i < toImport.length; i += CHUNK) {
        await importCustomersFromCSVRows(toImport.slice(i, i + CHUNK))
        done += Math.min(CHUNK, toImport.length - i)
        setProgress(Math.round((done / toImport.length) * 100))
      }
      setResult({ imported: toImport.length, skipped })
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setStep('map')
    }
  }

  function reset() {
    setStep('upload')
    setHeaders([])
    setRows([])
    setMapping({})
    setResult(null)
    setError(null)
    setProgress(0)
  }

  const mappedCount = FIELDS.filter(f => mapping[f.key]).length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">CSV Import</h1>
        <p className="text-sm text-gray-400 mt-0.5">Bulk-create records from a spreadsheet</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(['upload', 'map', 'done'] as const).map((s, i) => {
          const labels = ['Upload', 'Map Columns', 'Complete']
          const active = step === s || (step === 'importing' && s === 'map')
          const past   = (i === 0 && step !== 'upload') ||
                         (i === 1 && (step === 'importing' || step === 'done')) ||
                         (i === 2 && step === 'done')
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="w-8 h-px bg-gray-700" />}
              <div className={`flex items-center gap-1.5 ${active ? 'text-indigo-400' : past ? 'text-gray-400' : 'text-gray-600'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border ${
                  active ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300' :
                  past   ? 'border-gray-600 bg-gray-700 text-gray-400' :
                           'border-gray-700 text-gray-600'
                }`}>
                  {past && !active ? '✓' : i + 1}
                </div>
                <span className="font-medium">{labels[i]}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Step: Upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="card p-12 flex flex-col items-center justify-center gap-4 cursor-pointer border-2 border-dashed border-gray-700 hover:border-indigo-600/50 hover:bg-gray-800/50 transition-colors"
          >
            <span className="text-5xl">📂</span>
            <div className="text-center">
              <p className="text-gray-200 font-medium">Drop a CSV file here</p>
              <p className="text-sm text-gray-500 mt-1">or click to browse</p>
            </div>
            <p className="text-xs text-gray-600">First row must be column headers</p>
          </div>

          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange} />

          {error && (
            <div className="card p-4 border border-red-800/40 bg-red-900/10">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Template download */}
          <div className="card p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-200">Need a template?</p>
              <p className="text-xs text-gray-500 mt-0.5">Download a starter CSV with the correct column names</p>
            </div>
            <button
              onClick={() => {
                const cols = FIELDS.map(f => f.label).join(',')
                const blob = new Blob([cols + '\n'], { type: 'text/csv' })
                const url  = URL.createObjectURL(blob)
                const a    = document.createElement('a')
                a.href = url; a.download = 'import_template.csv'; a.click()
                URL.revokeObjectURL(url)
              }}
              className="btn-secondary text-sm px-4 py-1.5 shrink-0"
            >
              Download Template
            </button>
          </div>
        </div>
      )}

      {/* Step: Map columns */}
      {(step === 'map') && (
        <div className="space-y-4">
          {/* File summary */}
          <div className="card p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">{rows.length} rows detected</p>
              <p className="text-xs text-gray-500 mt-0.5">{headers.length} columns · {mappedCount} fields auto-matched</p>
            </div>
            <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              ← Change file
            </button>
          </div>

          {error && (
            <div className="card p-4 border border-red-800/40 bg-red-900/10">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Default category for rows without category */}
          <div className="card p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-200">Default Category</p>
              <p className="text-xs text-gray-500 mt-0.5">Used when the "Category" column is empty or unmapped</p>
            </div>
            <select
              value={defaultCat}
              onChange={e => setDefaultCat(e.target.value)}
              className="input-field text-sm py-1.5 w-32 shrink-0"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Mapping table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Column Mapping</p>
            </div>
            <div className="divide-y divide-gray-700/30">
              {FIELDS.map(f => {
                const sample = mapping[f.key] && rows[0] ? (rows[0][mapping[f.key]] ?? '') : ''
                return (
                  <div key={f.key} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-32 shrink-0">
                      <p className="text-sm text-gray-300 font-medium">
                        {f.label}
                        {f.required && <span className="text-red-400 ml-0.5">*</span>}
                      </p>
                    </div>
                    <select
                      value={mapping[f.key] ?? ''}
                      onChange={e => setMap(f.key, e.target.value)}
                      className="input-field text-sm py-1 flex-1 min-w-0"
                    >
                      <option value="">— Skip —</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    {sample && (
                      <p className="text-xs text-gray-500 w-32 shrink-0 truncate" title={sample}>
                        e.g. {sample}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Preview table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Preview</p>
              <p className="text-xs text-gray-600">First 3 rows</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-700/50">
                    {FIELDS.filter(f => mapping[f.key]).map(f => (
                      <th key={f.key} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/20">
                  {rows.slice(0, 3).map((row, ri) => (
                    <tr key={ri}>
                      {FIELDS.filter(f => mapping[f.key]).map(f => (
                        <td key={f.key} className="px-3 py-2 text-gray-300 max-w-[140px] truncate whitespace-nowrap">
                          {row[mapping[f.key]] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {FIELDS.filter(f => mapping[f.key]).length === 0 && (
                <p className="px-4 py-5 text-sm text-gray-500 text-center">Map at least one column above to see a preview.</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={reset} className="btn-secondary text-sm px-4 py-2">
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!mapping['first'] && !mapping['lastname'] && !mapping['phone']}
              className="btn-primary text-sm px-6 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import {rows.length} Records →
            </button>
          </div>
        </div>
      )}

      {/* Step: Importing */}
      {step === 'importing' && (
        <div className="card p-10 flex flex-col items-center gap-5">
          <div className="w-12 h-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-gray-200 font-medium">Importing records…</p>
            <p className="text-sm text-gray-500 mt-1">{progress}% complete</p>
          </div>
          <div className="w-full max-w-xs bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-600">Do not close this tab</p>
        </div>
      )}

      {/* Step: Done */}
      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="card p-8 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
              <span className="text-3xl">✅</span>
            </div>
            <div>
              <p className="text-xl font-bold text-white">{result.imported} records imported</p>
              {result.skipped > 0 && (
                <p className="text-sm text-gray-400 mt-1">{result.skipped} rows skipped (no name or phone)</p>
              )}
            </div>
            <div className="flex gap-3 mt-2">
              <Link to="/customers" className="btn-primary text-sm px-5 py-2">
                View Records
              </Link>
              <button onClick={reset} className="btn-secondary text-sm px-5 py-2">
                Import Another
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
