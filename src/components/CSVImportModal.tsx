import { useRef, useState, useCallback } from 'react'
import {
  parseCSV, detectColumns, csvRowToCustomer, downloadCSVTemplate,
  FIELD_LABELS, type ColumnMap,
} from '../utils/csvImport'
import { importCustomersFromCSVRows } from '../services/customerService'
import type { CustomerCategory } from '../models/customer'

type Step = 'upload' | 'preview' | 'importing' | 'done'

interface Props {
  defaultCategory: CustomerCategory
  onClose: () => void
  onImported: (count: number) => void
}

const CATEGORIES: CustomerCategory[] = ['Lead', 'Customer', 'Vendor', 'Employee']

// Fields we consider "important" — warn if none detected
const REQUIRED_FIELDS: (keyof ColumnMap)[] = ['first', 'lastname', 'phone']

export default function CSVImportModal({ defaultCategory, onClose, onImported }: Props) {
  const [step, setStep]             = useState<Step>('upload')
  const [headers, setHeaders]       = useState<string[]>([])
  const [dataRows, setDataRows]     = useState<string[][]>([])
  const [colMap, setColMap]         = useState<ColumnMap>({})
  const [category, setCategory]     = useState<CustomerCategory>(defaultCategory)
  const [importCount, setImportCount] = useState(0)
  const [error, setError]           = useState<string | null>(null)
  const [dragging, setDragging]     = useState(false)
  const fileRef                     = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setError('Please select a .csv file.')
      return
    }
    setError(null)
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (rows.length < 2) { setError('CSV must have a header row and at least one data row.'); return }
      const [hRow, ...dRows] = rows
      const map = detectColumns(hRow)
      setHeaders(hRow)
      setDataRows(dRows)
      setColMap(map)
      setStep('preview')
    } catch {
      setError('Could not parse the CSV file. Make sure it is a valid comma-separated file.')
    }
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) processFile(f)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  async function handleImport() {
    setStep('importing')
    setError(null)
    try {
      const converted = dataRows.map(row => csvRowToCustomer(row, colMap, category))
      const { count } = await importCustomersFromCSVRows(converted)
      setImportCount(count)
      setStep('done')
      onImported(count)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
      setStep('preview')
    }
  }

  const detectedFields = Object.keys(colMap) as (keyof ColumnMap)[]
  const missingRequired = REQUIRED_FIELDS.filter(f => !(f in colMap))
  const previewRows = dataRows.slice(0, 5)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/60">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">📥</span>
            <div>
              <h2 className="text-base font-semibold text-white">Import CSV</h2>
              <p className="text-xs text-gray-400">
                {step === 'upload'    && 'Upload a spreadsheet to import records'}
                {step === 'preview'   && `${dataRows.length} row${dataRows.length !== 1 ? 's' : ''} detected — review before importing`}
                {step === 'importing' && 'Importing…'}
                {step === 'done'      && `${importCount} records imported successfully`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded-lg hover:bg-gray-700"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── UPLOAD STEP ─────────────────────────────────────────────────── */}
          {step === 'upload' && (
            <div className="p-5 space-y-4">
              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragging
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-gray-700 hover:border-gray-500 hover:bg-gray-800/50'
                }`}
              >
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
                <p className="text-3xl mb-3">📄</p>
                <p className="text-gray-200 font-medium">Drop a CSV file here</p>
                <p className="text-gray-500 text-sm mt-1">or click to browse</p>
                <p className="text-gray-600 text-xs mt-3">Accepts .csv from Excel, Google Sheets, Numbers</p>
              </div>

              {/* Template download */}
              <div className="bg-gray-800/50 rounded-xl p-4 flex items-start gap-3">
                <span className="text-xl mt-0.5">📋</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200">Don't have a CSV yet?</p>
                  <p className="text-xs text-gray-400 mt-0.5">Download our template with the correct column names pre-filled.</p>
                </div>
                <button
                  onClick={downloadCSVTemplate}
                  className="btn-secondary text-xs px-3 py-1.5 shrink-0"
                >
                  Download Template
                </button>
              </div>

              {/* Column tips */}
              <div className="text-xs text-gray-500 space-y-1">
                <p className="font-medium text-gray-400">Recognized column names:</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(FIELD_LABELS).slice(0, 12).map(([k, label]) => (
                    <span key={k} className="text-gray-600">
                      <span className="text-gray-400 font-medium">{label}</span>
                    </span>
                  ))}
                </div>
              </div>

              {error && <p className="text-red-400 text-sm bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}

          {/* ── PREVIEW STEP ────────────────────────────────────────────────── */}
          {step === 'preview' && (
            <div className="p-5 space-y-4">
              {/* Detected columns */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Auto-detected columns ({detectedFields.length} of {headers.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {detectedFields.map(f => (
                    <span key={f} className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-500/10 border border-green-500/30 rounded-lg text-xs text-green-300">
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      <span className="font-medium">{FIELD_LABELS[f] ?? f}</span>
                      <span className="text-green-600 ml-0.5">← {headers[colMap[f]!]}</span>
                    </span>
                  ))}
                  {headers.filter((_, i) => !Object.values(colMap).includes(i)).map((h, idx) => (
                    <span key={idx} className="px-2.5 py-1 bg-gray-700/40 border border-gray-700 rounded-lg text-xs text-gray-500">
                      {h} (ignored)
                    </span>
                  ))}
                </div>
              </div>

              {/* Warning if key fields missing */}
              {missingRequired.length > 0 && (
                <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5 text-yellow-300 text-xs">
                  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <span>
                    Could not detect: <strong>{missingRequired.map(f => FIELD_LABELS[f]).join(', ')}</strong>.
                    Records will still import but those fields will be blank.
                  </span>
                </div>
              )}

              {/* Import as category */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-gray-400 shrink-0">Import as:</label>
                <div className="flex gap-1.5">
                  {CATEGORIES.map(c => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        category === c
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-gray-500">
                  (CSV "category" column overrides this per-row)
                </span>
              </div>

              {/* Preview table */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Preview — first {Math.min(5, dataRows.length)} of {dataRows.length} rows
                </p>
                <div className="overflow-x-auto rounded-xl border border-gray-700">
                  <table className="text-xs min-w-full">
                    <thead className="bg-gray-800">
                      <tr>
                        {headers.map((h, i) => (
                          <th
                            key={i}
                            className={`px-3 py-2 text-left font-medium whitespace-nowrap ${
                              Object.values(colMap).includes(i)
                                ? 'text-green-400'
                                : 'text-gray-500'
                            }`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {previewRows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-gray-800/50">
                          {headers.map((_, ci) => (
                            <td
                              key={ci}
                              className={`px-3 py-2 max-w-[160px] truncate ${
                                Object.values(colMap).includes(ci)
                                  ? 'text-gray-200'
                                  : 'text-gray-600'
                              }`}
                              title={row[ci] ?? ''}
                            >
                              {row[ci] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {error && <p className="text-red-400 text-sm bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}

          {/* ── IMPORTING STEP ──────────────────────────────────────────────── */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-300 font-medium">Importing {dataRows.length} records…</p>
              <p className="text-gray-500 text-sm">This may take a moment</p>
            </div>
          )}

          {/* ── DONE STEP ───────────────────────────────────────────────────── */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center">
                <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-white font-semibold text-lg">{importCount} records imported</p>
                <p className="text-gray-400 text-sm mt-1">They're now in your {category} list</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-700/60">
          {step === 'upload' && (
            <>
              <div />
              <button onClick={onClose} className="btn-secondary text-sm px-4 py-2">Cancel</button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button
                onClick={() => setStep('upload')}
                className="btn-secondary text-sm px-4 py-2 flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={dataRows.length === 0}
                className="btn-primary text-sm px-5 py-2 disabled:opacity-40"
              >
                Import {dataRows.length} {dataRows.length === 1 ? 'record' : 'records'}
              </button>
            </>
          )}
          {step === 'importing' && (
            <>
              <div />
              <button disabled className="btn-primary text-sm px-5 py-2 opacity-40 cursor-not-allowed">
                Importing…
              </button>
            </>
          )}
          {step === 'done' && (
            <>
              <div />
              <button onClick={onClose} className="btn-primary text-sm px-5 py-2">Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
