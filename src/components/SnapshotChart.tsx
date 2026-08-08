import { BarChart, Bar, XAxis, Cell, Tooltip, ResponsiveContainer } from 'recharts'

interface Entry {
  label: string
  count: number
  color: string
}

interface Props {
  entries: Entry[]
}

export default function SnapshotChart({ entries }: Props) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={entries} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
        <XAxis
          dataKey="label"
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
          labelStyle={{ color: '#f3f4f6', fontWeight: 600 }}
          itemStyle={{ color: '#d1d5db' }}
          formatter={(value: number) => [value, 'Count']}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {entries.map((e, i) => (
            <Cell key={i} fill={e.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
