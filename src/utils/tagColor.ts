const PALETTE = [
  'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
  'bg-violet-500/20 text-violet-300 border border-violet-500/30',
  'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
  'bg-teal-500/20 text-teal-300 border border-teal-500/30',
  'bg-green-500/20 text-green-300 border border-green-500/30',
  'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  'bg-orange-500/20 text-orange-300 border border-orange-500/30',
  'bg-rose-500/20 text-rose-300 border border-rose-500/30',
  'bg-pink-500/20 text-pink-300 border border-pink-500/30',
]

export function tagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) & 0x7fffffff
  }
  return PALETTE[hash % PALETTE.length]
}
