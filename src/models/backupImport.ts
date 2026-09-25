// Settings' JSON import: what the confirmation says before anything is written.

export interface PendingImport {
  text: string
  kind: 'records' | 'expenses' | 'todos'
  count: number
  /** Entries carrying an ID — they update the live item with that ID. */
  withIds: number
  fileName: string
}

const IMPORT_NOUN: Record<PendingImport['kind'], [string, string]> = {
  records: ['record', 'records'], expenses: ['expense', 'expenses'], todos: ['todo', 'todos'],
}

export function importConfirmMessage(p: Pick<PendingImport, 'kind' | 'count' | 'withIds' | 'fileName'>): string {
  const [one, many] = IMPORT_NOUN[p.kind]
  const n = (k: number) => `${k} ${k === 1 ? one : many}`
  let msg = `Import ${n(p.count)} from ${p.fileName} into your company?`
  if (p.withIds > 0) {
    msg += ` ${p.withIds === p.count ? 'All of them carry' : `${p.withIds} carry`} an ID: any that already exist are updated with the file's values`
    msg += p.kind === 'records' ? ' (fields the file doesn\u2019t have are kept).' : '.'
  }
  return msg + ' This can\u2019t be undone.'
}
