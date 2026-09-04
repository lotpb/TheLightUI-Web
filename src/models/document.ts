export interface CustomerDocument {
  id: string
  companyId: string
  customerId: string
  name: string
  url: string
  storagePath: string
  size: number
  mimeType: string
  uploadedBy: string
  uploadedByName: string
  createdAt: Date
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Visual class for a file, for the caller to map to an icon. */
export type FileKind = 'image' | 'document' | 'spreadsheet' | 'other'

/**
 * Returns a kind rather than a glyph. This used to hand back 🖼 📄 📝 📊 📎 —
 * Apple Color Emoji, which ignores `color` and so never followed the row's text
 * colour or light mode, and renders as different artwork per platform. A model
 * can't import from components/, hence a kind the view resolves.
 *
 * PDF and Word collapse into one 'document' kind on purpose: the icon's job is
 * to separate a document from a spreadsheet from an image at a glance, and the
 * filename beside it already says which of the two it is.
 */
export function fileIcon(mimeType: string): FileKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'document'
  if (mimeType.includes('word') || mimeType.includes('document')) return 'document'
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'spreadsheet'
  return 'other'
}
