import { useState, useMemo } from 'react'

const PRESETS = [
  { label: '15%', value: 15 },
  { label: '18%', value: 18 },
  { label: '20%', value: 20 },
  { label: '25%', value: 25 },
]

export default function TipPage() {
  const [bill,    setBill]    = useState('')
  const [tipPct,  setTipPct]  = useState(20)
  const [custom,  setCustom]  = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [people,  setPeople]  = useState(1)

  const billNum    = parseFloat(bill)    || 0
  const activePct  = useCustom ? (parseFloat(custom) || 0) : tipPct
  const tipTotal   = billNum * (activePct / 100)
  const grandTotal = billNum + tipTotal
  const perPerson  = people > 1 ? grandTotal / people : 0

  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const tipSuggestions = useMemo(() => {
    if (!billNum) return []
    return PRESETS.map(p => ({
      label: p.label,
      tip: billNum * (p.value / 100),
    }))
  }, [billNum])

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-6">Tip Calculator</h1>

      <div className="card p-5 space-y-5">
        {/* Bill */}
        <div>
          <label className="form-label">Bill Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={bill}
              onChange={e => setBill(e.target.value)}
              placeholder="0.00"
              className="input-field w-full pl-7"
            />
          </div>
        </div>

        {/* Tip % presets */}
        <div>
          <label className="form-label">Tip Percentage</label>
          <div className="grid grid-cols-4 gap-2 mb-2">
            {PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => { setTipPct(p.value); setUseCustom(false) }}
                className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
                  !useCustom && tipPct === p.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseCustom(true)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                useCustom ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Custom
            </button>
            {useCustom && (
              <div className="relative flex-1">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  value={custom}
                  onChange={e => setCustom(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="input-field w-full pr-7"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
              </div>
            )}
          </div>
        </div>

        {/* People */}
        <div>
          <label className="form-label">Split Between</label>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPeople(p => Math.max(1, p - 1))}
              className="w-9 h-9 rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 font-bold text-lg transition-colors"
            >
              −
            </button>
            <span className="text-white font-semibold w-8 text-center">
              {people} {people === 1 ? 'person' : 'people'}
            </span>
            <button
              onClick={() => setPeople(p => p + 1)}
              className="w-9 h-9 rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 font-bold text-lg transition-colors"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Result */}
      {billNum > 0 && (
        <div className="card mt-4 p-5 space-y-3">
          <ResultRow label="Bill"        value={fmt(billNum)}    />
          <ResultRow label={`Tip (${activePct}%)`} value={fmt(tipTotal)} accent />
          <div className="border-t border-gray-700/50 pt-3">
            <ResultRow label="Total"     value={fmt(grandTotal)} bold />
          </div>
          {people > 1 && (
            <div className="border-t border-gray-700/50 pt-3">
              <ResultRow
                label={`Each (÷ ${people})`}
                value={fmt(perPerson)}
                bold
                accent
              />
            </div>
          )}
        </div>
      )}

      {/* Tip reference table */}
      {billNum > 0 && (
        <div className="card mt-4 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Quick Reference</p>
          </div>
          <div className="divide-y divide-gray-700/30">
            {tipSuggestions.map(s => (
              <div key={s.label} className="flex justify-between px-4 py-2.5">
                <span className="text-sm text-gray-400">{s.label} tip</span>
                <span className="text-sm text-gray-200 font-medium">{fmt(s.tip)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ResultRow({
  label, value, bold, accent
}: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={`text-sm ${bold ? 'text-gray-200 font-semibold' : 'text-gray-400'}`}>{label}</span>
      <span className={`text-xl font-bold ${accent ? 'text-indigo-400' : 'text-white'}`}>{value}</span>
    </div>
  )
}
