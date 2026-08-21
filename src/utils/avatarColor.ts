// Dark mode — translucent with pastel text
const PALETTE_DARK = [
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

// Light mode — solid colors with white text so initials are legible
const PALETTE_LIGHT = [
  { bg: '#4f46e5', text: '#ffffff' }, // indigo
  { bg: '#059669', text: '#ffffff' }, // emerald
  { bg: '#d97706', text: '#ffffff' }, // amber
  { bg: '#dc2626', text: '#ffffff' }, // red
  { bg: '#db2777', text: '#ffffff' }, // pink
  { bg: '#0284c7', text: '#ffffff' }, // sky
  { bg: '#7c3aed', text: '#ffffff' }, // purple
  { bg: '#0d9488', text: '#ffffff' }, // teal
  { bg: '#ea580c', text: '#ffffff' }, // orange
  { bg: '#ca8a04', text: '#ffffff' }, // yellow
]

export const AVATAR_ORIGINAL = { bg: 'rgba(67,56,202,0.30)', text: '#a5b4fc' }
export const AVATAR_ORIGINAL_LIGHT = { bg: '#4338ca', text: '#ffffff' }

export function avatarColor(name: string): { bg: string; text: string } {
  const lightMode = document.documentElement.classList.contains('light-mode')
  const palette = lightMode ? PALETTE_LIGHT : PALETTE_DARK
  if (!name) return palette[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return palette[Math.abs(hash) % palette.length]
}

export function avatarOriginal(): { bg: string; text: string } {
  return document.documentElement.classList.contains('light-mode')
    ? AVATAR_ORIGINAL_LIGHT
    : AVATAR_ORIGINAL
}
