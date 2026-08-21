export type CustomFieldType = 'text' | 'number' | 'date' | 'select'

export interface CustomFieldDef {
  id: string
  companyId: string
  label: string
  key: string        // storage key inside CustomerItem.customFields
  type: CustomFieldType
  options: string[]  // only used when type === 'select'
  order: number
  createdAt: Date
}

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text:   'Text',
  number: 'Number',
  date:   'Date',
  select: 'Dropdown',
}

export function slugifyFieldKey(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return slug || `field_${Date.now()}`
}
