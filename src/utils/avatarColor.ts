const PALETTE = [
  { bg: 'rgba(99,102,241,0.30)',  text: '#a5b4fc' }, // indigo
  { bg: 'rgba(16,185,129,0.30)', text: '#6ee7b7' },  // emerald
  { bg: 'rgba(245,158,11,0.30)', text: '#fcd34d' },  // amber
  { bg: 'rgba(239,68,68,0.30)',  text: '#fca5a5' },  // red
  { bg: 'rgba(236,72,153,0.30)', text: '#f9a8d4' },  // pink
  { bg: 'rgba(14,165,233,0.30)', text: '#7dd3fc' },  // sky
  { bg: 'rgba(168,85,247,0.30)', text: '#d8b4fe' },  // purple
  { bg: 'rgba(20,184,166,0.30)', text: '#5eead4' },  // teal
  { bg: 'rgba(249,115,22,0.30)', text: '#fdba74' },  // orange
  { bg: 'rgba(234,179,8,0.30)',  text: '#fde047' },  // yellow
]

export const AVATAR_ORIGINAL = { bg: 'rgba(67,56,202,0.30)', text: '#a5b4fc' }

export function avatarColor(name: string): { bg: string; text: string } {
  if (!name) return PALETTE[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}
