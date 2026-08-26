import type { Invoice } from '../models/invoice'
import { invoiceTotal } from '../models/invoice'
import type { Expense } from '../models/expense'

function qbDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

function iifSafe(s: string | undefined): string {
  return (s ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ').trim()
}

function csvSafe(v: string | number): string {
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

// QuickBooks Desktop IIF: one AR transaction (!TRNS) per invoice, one split
// (!SPL) per line item, closed with ENDTRNS. Import via File > Utilities >
// Import IIF Files in QuickBooks Desktop.
export function buildInvoiceIIF(invoices: Invoice[]): string {
  const lines: string[] = [
    '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
    '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO',
    '!ENDTRNS',
  ]

  invoices.forEach((inv, idx) => {
    const id = idx + 1
    const total = invoiceTotal(inv)
    lines.push([
      'TRNS', id, 'INVOICE', qbDate(inv.issueDate), 'Accounts Receivable',
      iifSafe(inv.customerName), total.toFixed(2), iifSafe(inv.invoiceNumber), iifSafe(inv.notes),
    ].join('\t'))

    for (const item of inv.lineItems) {
      const amt = item.qty * item.rate
      lines.push([
        'SPL', id, 'INVOICE', qbDate(inv.issueDate), 'Sales',
        iifSafe(inv.customerName), (-amt).toFixed(2), iifSafe(item.description),
      ].join('\t'))
    }

    lines.push('ENDTRNS')
  })

  return lines.join('\n')
}

// QuickBooks Online invoice import CSV — one row per line item, matching the
// column shape QBO's own CSV importer (Sales > Invoices > Import) expects.
export function buildInvoiceQBOCSV(invoices: Invoice[]): string {
  const rows: (string | number)[][] = [
    ['Customer', 'InvoiceNo', 'InvoiceDate', 'DueDate', 'Item', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Memo'],
  ]
  for (const inv of invoices) {
    for (const item of inv.lineItems) {
      rows.push([
        inv.customerName, inv.invoiceNumber, qbDate(inv.issueDate), qbDate(inv.dueDate),
        'Services', item.description, item.qty, item.rate.toFixed(2), (item.qty * item.rate).toFixed(2), inv.notes,
      ])
    }
  }
  return rows.map(r => r.map(v => csvSafe(v)).join(',')).join('\n')
}

// QuickBooks Online bank-register CSV — Date/Description/Amount, negative for
// money out. Import via Banking > Upload from file in QBO.
export function buildExpenseQBOCSV(expenses: Expense[]): string {
  const rows: (string | number)[][] = [['Date', 'Description', 'Amount']]
  for (const e of expenses) {
    const desc = e.category ? `${e.title} (${e.category})` : e.title
    rows.push([qbDate(e.date), desc, (-e.amount).toFixed(2)])
  }
  return rows.map(r => r.map(v => csvSafe(v)).join(',')).join('\n')
}
